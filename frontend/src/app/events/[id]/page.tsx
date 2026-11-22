'use client';

import { useEffect, useState, useCallback } from 'react';
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
  event: { title: string; venue: { name: string; city?: string } };
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
  const [errorMsg, setErrorMsg] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async (currentUserId: number | null) => {
    try {
      const next = await apiFetch<MapData>(`/api/events/${id}/seat-map`);
      setData(next);
      if (currentUserId !== null) {
        const mine = next.seats.find(
          (seat) => seat.status === 'Held' && Number(seat.heldByUserId) === Number(currentUserId)
        );
        setHeldExpiry(mine?.expiresAt ?? null);
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    const saved = localStorage.getItem('user');
    if (!saved) {
      router.push('/login');
      return;
    }
    const parsed = JSON.parse(saved);
    const savedUserId = Number(parsed.id);
    setUserId(savedUserId);
    load(savedUserId);

    const timer = setInterval(() => load(savedUserId), 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [id, load, router]);

  const hold = async () => {
    if (!selected.length || holding) return;
    setHolding(true);
    setErrorMsg('');
    setMessage('');
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
      setErrorMsg((e as Error).message);
    } finally {
      setHolding(false);
    }
  };

  const confirm = async () => {
    if (confirming) return;
    setConfirming(true);
    setErrorMsg('');
    setMessage('');
    try {
      await apiFetch('/api/bookings/confirm', {
        method: 'POST',
        body: JSON.stringify({ eventId: Number(id) })
      });
      router.push('/tickets');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Unable to confirm booking. Please try again.');
      setConfirming(false);
    }
  };

  const releaseHold = async () => {
    setErrorMsg('');
    setMessage('');
    try {
      await apiFetch(`/api/bookings/holds?eventId=${id}`, { method: 'DELETE' });
      setHeldExpiry(null);
      setMessage('Seat hold released.');
      await load(userId);
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  };

  if (!data) return <div className="empty">{errorMsg || 'Loading live seat map...'}</div>;

  const priceMap = new Map(data.priceTiers.map((t) => [t.category, t.price]));
  const rows = Array.from(new Set(data.seats.map((seat) => seat.rowLabel)));

  const myHeldSeats = data.seats.filter(
    (seat) => seat.status === 'Held' && Number(seat.heldByUserId) === Number(userId)
  );
  const heldTotal = myHeldSeats.reduce((sum, s) => sum + (priceMap.get(s.category) ?? 0), 0);
  const selectedTotal = data.seats
    .filter((s) => selected.includes(s.id))
    .reduce((sum, s) => sum + (priceMap.get(s.category) ?? 0), 0);

  const secondsLeft = heldExpiry
    ? Math.max(0, Math.ceil((new Date(heldExpiry).getTime() - now) / 1000))
    : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Live Seat Selection</span>
          <h1>{data.event.title}</h1>
          <p className="muted">
            {data.event.venue.name}{data.event.venue.city ? ` · ${data.event.venue.city}` : ''}
          </p>
        </div>
        <div className="legend">
          <span><i style={{ background: '#12b76a' }} /> Available</span>
          <span><i style={{ background: '#111827' }} /> Selected</span>
          <span><i style={{ background: '#fdb022' }} /> Held</span>
          <span><i style={{ background: '#f04438' }} /> Booked</span>
        </div>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {message && <div className="alert">{message}</div>}

      {myHeldSeats.length > 0 && (
        <div className="panel checkout-banner">
          <div>
            <strong>
              {myHeldSeats.length} Seat(s) Held: {myHeldSeats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(', ')}
            </strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Total Payable: <strong>₹{heldTotal}</strong> · Expires in <strong>{countdown}</strong>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="button button-success"
              disabled={confirming}
              onClick={confirm}
            >
              {confirming ? 'Processing Payment...' : `Pay ₹${heldTotal} & Confirm Booking`}
            </button>
            <button
              className="button button-danger"
              disabled={confirming}
              onClick={releaseHold}
            >
              Release Hold
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="stage">STAGE / SCREEN FRONT</div>
        <div className="seat-map">
          {rows.map((row) => (
            <div className="seat-row" key={row}>
              <strong className="row-label">{row}</strong>
              {data.seats.filter((seat) => seat.rowLabel === row).map((seat) => {
                const mine = selected.includes(seat.id);
                const unavailable =
                  seat.status === 'Booked' ||
                  (seat.status === 'Held' && Number(seat.heldByUserId) !== Number(userId));
                return (
                  <button
                    className={`seat ${mine ? 'mine' : ''} ${seat.status.toLowerCase()}`}
                    disabled={unavailable}
                    title={`${seat.rowLabel}${seat.seatNumber} (${seat.category} - ₹${priceMap.get(seat.category) ?? 0})`}
                    key={seat.id}
                    onClick={() =>
                      setSelected((old) =>
                        old.includes(seat.id)
                          ? old.filter((x) => x !== seat.id)
                          : old.length < 6
                            ? [...old, seat.id]
                            : old
                      )
                    }
                  >
                    {seat.rowLabel}{seat.seatNumber}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: '0 0 8px' }}>
              <strong>{selected.length}</strong> seat(s) selected · Subtotal: <strong>₹{selectedTotal}</strong> (Max 6)
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {data.priceTiers.map((tier) => (
                <span className="tag" key={tier.id}>
                  {tier.category}: ₹{tier.price}
                </span>
              ))}
            </div>
          </div>
          <button
            className="button button-primary"
            disabled={!selected.length || holding}
            onClick={hold}
          >
            {holding ? 'Holding Seats...' : 'Hold Selected Seats (10 Min)'}
          </button>
        </div>
      </div>
    </>
  );
}