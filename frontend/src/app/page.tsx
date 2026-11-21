'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Event = { id: number; title: string; category: string; eventDateTime: string; venue: { name: string; city: string }; priceTiers: { price: number }[] };
export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]); const [city, setCity] = useState(''); const [category, setCategory] = useState(''); const [error, setError] = useState('');
  const load = async () => { try { const query = new URLSearchParams({ ...(city && { city }), ...(category && { category }) }); setEvents(await apiFetch<Event[]>(`/api/events?${query}`)); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);
  return <><section className="hero"><p className="eyebrow">One platform. Every seat.</p><h1>Find your next live experience.</h1><p>Discover concerts, theatre and sports events. Choose your seats, book securely and enter with a QR e-ticket.</p></section><div className="filters"><input className="field" placeholder="Filter by city" value={city} onChange={(e) => setCity(e.target.value)} /><input className="field" placeholder="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} /><button className="button button-dark" onClick={load}>Search events</button></div>{error && <div className="alert">{error}</div>}<div className="grid">{events.map((event) => <article className="card" key={event.id}><span className="tag">{event.category}</span><h2>{event.title}</h2><p className="muted">{event.venue.name}, {event.venue.city}</p><p className="muted">{new Date(event.eventDateTime).toLocaleString()}</p><p>From <strong>₹{Math.min(...event.priceTiers.map((tier) => tier.price))}</strong></p><Link className="button button-dark" href={`/events/${event.id}`}>Select seats</Link></article>)}</div>{!events.length && !error && <div className="empty">No published events yet. Create one from the Manage portal.</div>}</>;
}
