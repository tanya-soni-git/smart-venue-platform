import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__smartVenuePrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__smartVenuePrisma = prisma;

export async function purgeExpiredHolds(eventId) {
  await prisma.seatHold.deleteMany({
    where: { ...(eventId ? { eventId } : {}), expiresAt: { lte: new Date() } }
  });
}

export async function clearAllHolds(eventId) {
  const result = await prisma.seatHold.deleteMany({
    where: eventId ? { eventId } : {}
  });
  return { deletedCount: result.count };
}

export async function getSeatMapData(eventId) {
  const now = new Date();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      category: true,
      eventDateTime: true,
      status: true,
      venue: {
        select: {
          id: true,
          name: true,
          city: true,
          seats: {
            select: { id: true, section: true, rowLabel: true, seatNumber: true, category: true },
            orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }]
          }
        }
      },
      priceTiers: {
        select: { id: true, category: true, price: true }
      },
      bookedSeats: {
        where: { booking: { status: 'Confirmed' } },
        select: { seatId: true }
      },
      seatHolds: {
        where: { expiresAt: { gt: now } },
        select: { seatId: true, userId: true, expiresAt: true }
      }
    }
  });

  if (!event) throw new Error('Event not found');

  const booked = new Set(event.bookedSeats.map((s) => s.seatId));
  const holds = new Map(event.seatHolds.map((h) => [h.seatId, h]));

  return {
    event: {
      id: event.id,
      title: event.title,
      category: event.category,
      eventDateTime: event.eventDateTime,
      status: event.status,
      venue: { id: event.venue.id, name: event.venue.name, city: event.venue.city }
    },
    priceTiers: event.priceTiers,
    seats: event.venue.seats.map((seat) => {
      const hold = holds.get(seat.id);
      return {
        ...seat,
        status: booked.has(seat.id) ? 'Booked' : hold ? 'Held' : 'Available',
        heldByUserId: hold?.userId ?? null,
        expiresAt: hold?.expiresAt ?? null
      };
    })
  };
}

export async function holdSeats(eventId, userId, seatIds) {
  if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 6) {
    throw new Error('Select between 1 and 6 seats per booking');
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== 'Published' || event.eventDateTime <= new Date()) {
    throw new Error('Ticket sales are closed for this event');
  }

  await purgeExpiredHolds(eventId);

  const alreadyBooked = await prisma.bookedSeat.findFirst({
    where: { eventId, seatId: { in: seatIds }, booking: { status: 'Confirmed' } }
  });
  if (alreadyBooked) throw new Error('One or more selected seats are already booked');

  const heldByOther = await prisma.seatHold.findFirst({
    where: { eventId, seatId: { in: seatIds }, userId: { not: userId } }
  });
  if (heldByOther) throw new Error('One or more selected seats are held by another customer');

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.$transaction([
    prisma.seatHold.deleteMany({ where: { eventId, userId } }),
    prisma.seatHold.createMany({
      data: seatIds.map((seatId) => ({ eventId, seatId, userId, expiresAt }))
    })
  ]);

  return { message: 'Seats held for 10 minutes. Complete payment before expiry.', expiresAt };
}

export async function confirmBooking(eventId, userId) {
  const now = new Date();
  const holds = await prisma.seatHold.findMany({
    where: { eventId, userId, expiresAt: { gt: now } },
    include: { seat: true }
  });

  if (!holds.length) {
    await purgeExpiredHolds(eventId);
    throw new Error('Seat hold expired or no seats were held. Please select seats again.');
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { priceTiers: true }
  });
  if (!event) throw new Error('Event not found');

  // Verify none of these seats were double-booked
  const seatIds = holds.map((h) => h.seatId);
  const conflict = await prisma.bookedSeat.findFirst({
    where: { eventId, seatId: { in: seatIds }, booking: { status: 'Confirmed' } }
  });
  if (conflict) throw new Error('One or more seats were just booked by another user');

  const prices = new Map(event.priceTiers.map((tier) => [tier.category, tier.price]));
  const items = holds.map((hold) => ({
    seatId: hold.seatId,
    pricePaid: prices.get(hold.seat.category) ?? 0
  }));
  const totalAmount = items.reduce((sum, item) => sum + item.pricePaid, 0);

  // Execute fast DB write transaction without slow QR generation inside it
  const booking = await prisma.$transaction(
    async (tx) => {
      const created = await tx.booking.create({
        data: {
          eventId,
          userId,
          totalAmount,
          status: 'Confirmed',
          bookedSeats: {
            create: items.map((item) => ({
              eventId,
              seatId: item.seatId,
              pricePaid: item.pricePaid
            }))
          },
          payments: {
            create: { amount: totalAmount, txnType: 'Charge' }
          }
        },
        include: {
          bookedSeats: { include: { seat: true } },
          event: true
        }
      });

      await tx.seatHold.deleteMany({ where: { eventId, userId } });
      return created;
    },
    { maxWait: 10000, timeout: 15000 }
  );

  // Generate QR code after DB commit and attach to booking
  const qrPayload = `TICKET|${booking.bookingRef}|${event.eventCode}|${booking.qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload);

  return prisma.booking.update({
    where: { id: booking.id },
    data: { qrDataUrl },
    include: { bookedSeats: { include: { seat: true } }, event: true }
  });
}

export async function cancelBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { event: true }
  });
  if (!booking || booking.userId !== userId) throw new Error('Booking not found');
  if (booking.status === 'Cancelled') throw new Error('Booking is already cancelled');

  const hoursBefore = (booking.event.eventDateTime.getTime() - Date.now()) / 3600000;
  const refundRate = hoursBefore >= 168 ? 1 : hoursBefore >= 48 ? 0.5 : 0;
  const refundAmount = Math.round(booking.totalAmount * refundRate * 100) / 100;

  await prisma.$transaction(
    async (tx) => {
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'Cancelled' } });
      await tx.bookedSeat.deleteMany({ where: { bookingId: booking.id } });
      if (refundAmount > 0) {
        await tx.payment.create({
          data: { bookingId: booking.id, amount: refundAmount, txnType: 'Refund' }
        });
      }
    },
    { maxWait: 10000, timeout: 15000 }
  );

  return { message: `Booking cancelled. Refund issued: ₹${refundAmount} (${refundRate * 100}%)` };
}