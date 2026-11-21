import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { requireAuth, requireRoles } from './middleware/auth.js';
import { prisma, getSeatMapData, holdSeats, confirmBooking, cancelBooking } from './services/bookingService.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.json({ status: 'SmartVenue API running' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'smart-venue-backend' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) return res.status(400).json({ error: 'Name, email and a 6-character password are required' });
    const allowedRoles = ['Customer', 'Organizer', 'Admin', 'GateStaff', 'Finance'];
    const selectedRole = allowedRoles.includes(role) ? role : 'Customer';
    const cleanEmail = email.trim().toLowerCase();
    if (await prisma.user.findUnique({ where: { email: cleanEmail } })) return res.status(400).json({ error: 'Email already registered' });
    const user = await prisma.user.create({ data: { name: name.trim(), email: cleanEmail, passwordHash: await bcrypt.hash(password, 10), role: selectedRole } });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email?.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/venues', async (_req, res) => res.json(await prisma.venue.findMany({ include: { _count: { select: { seats: true } } } })));
app.post('/api/venues', requireAuth, requireRoles('Admin'), async (req, res) => {
  const { name, city, address, rows, cols } = req.body;
  const categories = ['Platinum', 'Gold', 'Silver', 'Accessible'];
  const seats = [];
  for (let r = 0; r < Number(rows); r++) for (let c = 1; c <= Number(cols); c++) seats.push({ section: 'Main', rowLabel: String.fromCharCode(65 + r), seatNumber: c, category: categories[Math.min(r, 3)] });
  res.status(201).json(await prisma.venue.create({ data: { name, city, address, capacity: seats.length, seats: { create: seats } } }));
});

app.get('/api/events', async (req, res) => {
  const { city, category, all } = req.query;
  res.json(await prisma.event.findMany({
    where: { ...(all === 'true' ? {} : { status: 'Published' }), ...(city ? { venue: { city: { contains: String(city), mode: 'insensitive' } } } : {}), ...(category ? { category: { contains: String(category), mode: 'insensitive' } } : {}) },
    include: { venue: true, priceTiers: true }, orderBy: { eventDateTime: 'asc' }
  }));
});
app.get('/api/events/:id/seat-map', async (req, res) => { try { res.json(await getSeatMapData(Number(req.params.id))); } catch (error) { res.status(404).json({ error: error.message }); } });
app.post('/api/events', requireAuth, requireRoles('Admin', 'Organizer'), async (req, res) => {
  const { title, category, eventDateTime, description, venueId, prices } = req.body;
  res.status(201).json(await prisma.event.create({ data: { title, category, eventDateTime: new Date(eventDateTime), description, venueId: Number(venueId), organizerId: req.user.id, priceTiers: { create: Object.entries(prices).map(([category, price]) => ({ category, price: Number(price) })) } } }));
});
app.patch('/api/events/:id/publish', requireAuth, requireRoles('Admin', 'Organizer'), async (req, res) => res.json(await prisma.event.update({ where: { id: Number(req.params.id) }, data: { status: 'Published' } })));
app.patch('/api/events/:id/cancel', requireAuth, requireRoles('Admin', 'Organizer'), async (req, res) => {
  const eventId = Number(req.params.id);
  const bookings = await prisma.booking.findMany({ where: { eventId, status: 'Confirmed' } });
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { status: 'Cancelled' } });
    for (const booking of bookings) {
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'Cancelled' } });
      await tx.bookedSeat.deleteMany({ where: { bookingId: booking.id } });
      await tx.payment.create({ data: { bookingId: booking.id, amount: booking.totalAmount, txnType: 'Refund' } });
    }
  });
  res.json({ message: 'Event cancelled and 100% refunds issued' });
});

app.get('/api/bookings/my', requireAuth, async (req, res) => res.json(await prisma.booking.findMany({ where: { userId: req.user.id }, include: { event: true, bookedSeats: { include: { seat: true } } }, orderBy: { createdAt: 'desc' } })));
app.post('/api/bookings/hold', requireAuth, async (req, res) => { try { res.json(await holdSeats(Number(req.body.eventId), req.user.id, req.body.seatIds)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.post('/api/bookings/confirm', requireAuth, async (req, res) => { try { res.json(await confirmBooking(Number(req.body.eventId), req.user.id)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.post('/api/bookings/:id/cancel', requireAuth, async (req, res) => { try { res.json(await cancelBooking(Number(req.params.id), req.user.id)); } catch (error) { res.status(400).json({ error: error.message }); } });

app.get('/api/gate/stats/:eventId', requireAuth, requireRoles('Admin', 'GateStaff'), async (req, res) => {
  const eventId = Number(req.params.eventId);
  res.json({ checkedIn: await prisma.entryLog.count({ where: { eventId } }), totalBookings: await prisma.booking.count({ where: { eventId, status: 'Confirmed' } }) });
});
app.post('/api/gate/scan', requireAuth, requireRoles('Admin', 'GateStaff'), async (req, res) => {
  const token = req.body.qrInput?.trim().split('|').pop();
  const booking = await prisma.booking.findUnique({ where: { qrToken: token }, include: { user: true, event: true, bookedSeats: { include: { seat: true } }, entryLog: true } });
  if (!booking) return res.status(400).json({ error: 'Invalid ticket: QR token not found' });
  if (booking.eventId !== Number(req.body.eventId)) return res.status(400).json({ error: `Wrong event: belongs to ${booking.event.title}` });
  if (booking.status !== 'Confirmed') return res.status(400).json({ error: `Ticket status is ${booking.status}` });
  if (booking.entryLog) return res.status(400).json({ error: 'Duplicate entry rejected: ticket already scanned' });
  await prisma.entryLog.create({ data: { bookingId: booking.id, eventId: booking.eventId, scannedBy: req.user.id } });
  res.json({ message: `Entry allowed: ${booking.user.name} | Ref: ${booking.bookingRef} | Seats: ${booking.bookedSeats.map((item) => `${item.seat.rowLabel}${item.seat.seatNumber}`).join(', ')}` });
});

app.get('/api/reports', requireAuth, requireRoles('Admin', 'Organizer', 'Finance'), async (_req, res) => {
  const events = await prisma.event.findMany({ include: { venue: true, bookings: { include: { bookedSeats: true, payments: true } }, entryLogs: true } });
  res.json(events.map((event) => {
    const confirmed = event.bookings.filter((booking) => booking.status === 'Confirmed');
    const ticketsSold = confirmed.reduce((sum, booking) => sum + booking.bookedSeats.length, 0);
    const grossRevenue = confirmed.reduce((sum, booking) => sum + booking.totalAmount, 0);
    const refunds = event.bookings.flatMap((booking) => booking.payments).filter((payment) => payment.txnType === 'Refund').reduce((sum, payment) => sum + payment.amount, 0);
    return { id: event.id, title: event.title, status: event.status, ticketsSold, capacity: event.venue.capacity, fillPct: event.venue.capacity ? Math.round(ticketsSold / event.venue.capacity * 1000) / 10 : 0, grossRevenue, refunds, netSettlement: Math.round((grossRevenue - refunds) * 0.95 * 100) / 100, checkIns: event.entryLogs.length };
  }));
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`));
