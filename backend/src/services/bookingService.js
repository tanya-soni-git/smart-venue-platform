import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__smartVenuePrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__smartVenuePrisma = prisma;

export async function purgeExpiredHolds(eventId) {
  await prisma.seatHold.deleteMany({ where: { eventId, expiresAt: { lte: new Date() } } });
}

export async function getSeatMapData(eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      venue: { include: { seats: { orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }] } } },
      priceTiers: true, bookedSeats: { where: { booking: { status: 'Confirmed' } } }, seatHolds: { where: { expiresAt: { gt: new Date() } } }
    }
  });
  if (!event) throw new Error('Event not found');
  const booked = new Set(event.bookedSeats.map((seat) => seat.seatId));
  const holds = new Map(event.seatHolds.map((hold) => [hold.seatId, hold]));
  return {
    event,
    priceTiers: event.priceTiers,
    seats: event.venue.seats.map((seat) => {
      const hold = holds.get(seat.id);
      return { ...seat, status: booked.has(seat.id) ? 'Booked' : hold ? 'Held' : 'Available', heldByUserId: hold?.userId ?? null, expiresAt: hold?.expiresAt ?? null };
    })
  };
}

export async function holdSeats(eventId, userId, seatIds) {
  if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 6) throw new Error('Select between 1 and 6 seats per booking');
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== 'Published' || event.eventDateTime <= new Date()) throw new Error('Ticket sales are closed for this event');
  await purgeExpiredHolds(eventId);
  if (await prisma.bookedSeat.findFirst({ where: { eventId, seatId: { in: seatIds }, booking: { status: 'Confirmed' } } })) throw new Error('One or more selected seats are already booked');
  if (await prisma.seatHold.findFirst({ where: { eventId, seatId: { in: seatIds }, userId: { not: userId } } })) throw new Error('One or more selected seats are held by another customer');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.$transaction([
    prisma.seatHold.deleteMany({ where: { eventId, userId } }),
    prisma.seatHold.createMany({ data: seatIds.map((seatId) => ({ eventId, seatId, userId, expiresAt })) })
  ]);
  return { message: 'Seats held for 10 minutes. Complete payment before expiry.', expiresAt };
}

export async function confirmBooking(eventId, userId) {
  await purgeExpiredHolds(eventId);
  const holds = await prisma.seatHold.findMany({ where: { eventId, userId }, include: { seat: true } });
  if (!holds.length) throw new Error('Seat hold expired or no seats were held');
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { priceTiers: true } });
  const prices = new Map(event.priceTiers.map((tier) => [tier.category, tier.price]));
  const items = holds.map((hold) => ({ seatId: hold.seatId, pricePaid: prices.get(hold.seat.category) || 0 }));
  const totalAmount = items.reduce((sum, item) => sum + item.pricePaid, 0);
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        eventId, userId, totalAmount, bookedSeats: { create: items.map((item) => ({ ...item, eventId })) },
        payments: { create: { amount: totalAmount, txnType: 'Charge' } }
      },
      include: { bookedSeats: { include: { seat: true } }, event: true }
    });
    await tx.seatHold.deleteMany({ where: { eventId, userId } });
    const qrDataUrl = await QRCode.toDataURL(`TICKET|${booking.bookingRef}|${event.eventCode}|${booking.qrToken}`);
    return tx.booking.update({ where: { id: booking.id }, data: { qrDataUrl }, include: { bookedSeats: { include: { seat: true } }, event: true } });
  });
}

export async function cancelBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { event: true } });
  if (!booking || booking.userId !== userId) throw new Error('Booking not found');
  if (booking.status === 'Cancelled') throw new Error('Booking is already cancelled');
  const hoursBefore = (booking.event.eventDateTime.getTime() - Date.now()) / 3600000;
  const refundRate = hoursBefore >= 168 ? 1 : hoursBefore >= 48 ? 0.5 : 0;
  const refundAmount = Math.round(booking.totalAmount * refundRate * 100) / 100;
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'Cancelled' } });
    await tx.bookedSeat.deleteMany({ where: { bookingId: booking.id } });
    if (refundAmount) await tx.payment.create({ data: { bookingId: booking.id, amount: refundAmount, txnType: 'Refund' } });
  });
  return { message: `Booking cancelled. Refund issued: ₹${refundAmount} (${refundRate * 100}%)` };
}
