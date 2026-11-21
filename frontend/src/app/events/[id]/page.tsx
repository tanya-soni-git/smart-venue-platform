'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type Seat = {
  id: number;
  rowLabel: string;
  seatNumber: number;
  category: string;
  status: string;
  heldByUserId: number | null;
  expiresAt: string | null;
};

type MapData = {
  event: { title: string; venue: { name: string } };
  priceTiers: { id: number; category: string; price: number }[];
  seats: Seat[];
};

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<MapData | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [heldExpiry, setHeldExpiry] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState('');
  const [userId, setUserId] = useState<number | null>(null);

  const load = async (currentUserId: number | null = userId) => {
    try {
      const next = await apiFetch<MapData>(`/api/events/${id}/seat-map`);
      setData(next);
      if (currentUserId) {
        const mine = next.seats.find(
          (seat) => seat.status === 'Held' && seat.heldByUserId === currentUserId
        );
        if (mine?.expiresAt) setHeldExpiry(mine.expiresAt);
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('user');
    if (!saved) {
      router.push('/login');
      return;
    }
    const savedUserId = JSON.parse(saved).id as number;
    setUserId(savedUserId);
    load(savedUserId);
    const timer = setInterval(() => load(savedUserId), 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [id]);

  const hold = async () => {
    try {
      const result = await apiFetch<{ message: string; expiresAt: string }>('/api/bookings/hold', {
        method: 'POST',
        body: JSON.stringify({ eventId: Number(id), seatIds: selected })
      });
      setSelected([]);
      setHeldExpiry(result.expiresAt);
      setMessage(result.message);
      await load(userId);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const confirm = async () => {
    try {
      setMessage('');
      await apiFetch('/api/bookings/confirm', {
        method: 'POST',
        body: JSON.stringify({ eventId: Number(id) })
      });
      router.push('/tickets');
    } catch (e) {
      setMessage((e as Error).message || 'Unable to confirm the booking. Please try again.');
    }
  };

  if (!data) return <div className="empty">{message || 'Loading live seat map...'}</div>;

  const rows = Array.from(new Set(data.seats.map((seat) => seat.rowLabel)));
  const activeHeld = data.seats.some(
    (seat) => seat.status === 'Held' && seat.heldByUserId === userId
  );
  const secondsLeft = heldExpiry
    ? Math.max(0, Math.ceil((new Date(heldExpiry).getTime() - now) / 1000))
    : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <>
      <h1>{data.event.title}</h1>
      <p className="muted">{data.event.venue.name}</p>
      <div className="legend">
        <span>🟢 Available</span>
        <span>🟡 Held (10 min)</span>
        <span>🔴 Booked</span>
      </div>
      {message && <div className="alert">{message}</div>}
      <div className="panel">
        <div className="stage">STAGE / SCREEN FRONT</div>
        <div className="seat-map">
          {rows.map((row) => (
            <div className="seat-row" key={row}>
              <strong>{row}</strong>
              {data.seats.filter((seat) => seat.rowLabel === row).map((seat) => {
                const mine = selected.includes(seat.id);
                const unavailable =
                  seat.status === 'Booked' ||
                  (seat.status === 'Held' && seat.heldByUserId !== userId);
                return (
                  <button
                    className={`seat ${mine ? 'mine' : ''} ${seat.status.toLowerCase()}`}
                    disabled={unavailable}
                    key={seat.id}
                    onClick={() => setSelected((old) =>
                      old.includes(seat.id)
                        ? old.filter((x) => x !== seat.id)
                        : old.length < 6
                          ? [...old, seat.id]
                          : old
                    )}
                  >
                    {seat.rowLabel}{seat.seatNumber}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {activeHeld && (
        <div className="panel" style={{ marginTop: 16, border: '2px solid #039855', background: '#ecfdf3' }}>
          <strong>Seats are held. Complete checkout before they expire.</strong>
          <p>Time remaining: <strong>{countdown}</strong></p>
          <button className="button button-success" onClick={confirm}>
            Pay & Confirm Booking Now
          </button>
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        <p>{selected.length} seat(s) selected · Max 6 per booking</p>
        <p>
          {data.priceTiers.map((tier) => (
            <span className="tag" key={tier.id}>{tier.category}: ₹{tier.price} </span>
          ))}
        </p>
        <button className="button button-primary" disabled={!selected.length} onClick={hold}>
          Hold selected seats
        </button>
      </div>
    </>
  );
}
