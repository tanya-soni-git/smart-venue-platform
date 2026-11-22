'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type EventItem = {
  id: number;
  title: string;
  category: string;
  eventDateTime: string;
  status: string;
  venue: {
    name: string;
    city: string;
  };
  priceTiers: {
    category: string;
    price: number;
  }[];
};

type EventFilter = 'All' | 'Upcoming' | 'Past';

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<EventFilter>('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const loadEvents = async () => {
      try {
        setEvents(await apiFetch<EventItem[]>('/api/events'));
      } catch (error) {
        setErrorMsg((error as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadEvents();
  }, []);

  const visibleEvents = useMemo(() => {
    const now = Date.now();
    const query = search.trim().toLowerCase();

    return events.filter((event) => {
      const eventTime = new Date(event.eventDateTime).getTime();
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Upcoming' && eventTime >= now) ||
        (filter === 'Past' && eventTime < now);
      const matchesSearch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        event.venue.name.toLowerCase().includes(query) ||
        event.venue.city.toLowerCase().includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [events, filter, search]);

  if (loading) return <div className="empty">Loading events...</div>;

  return (
    <>
      <div className="hero">
        <span className="eyebrow">Discover live experiences</span>
        <h1>Events</h1>
        <p>Browse upcoming concerts and events, then select and reserve your seats.</p>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}

      <div className="filters" style={{ gridTemplateColumns: '1fr auto' }}>
        <input
          className="field"
          placeholder="Search event, category, venue or city"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          {(['All', 'Upcoming', 'Past'] as EventFilter[]).map((item) => (
            <button
              type="button"
              key={item}
              className={`button ${filter === item ? 'button-primary' : 'button-dark'}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <div className="panel empty">
          <h3>No events found</h3>
          <p className="muted">Try another category or change the event filter.</p>
        </div>
      ) : (
        <div className="grid">
          {visibleEvents.map((event) => {
            const eventDate = new Date(event.eventDateTime);
            const isUpcoming = eventDate.getTime() >= Date.now();
            const lowestPrice = event.priceTiers.length
              ? Math.min(...event.priceTiers.map((tier) => tier.price))
              : null;

            return (
              <article className="card" key={event.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="tag">{event.category}</span>
                  <span className={`status-pill ${isUpcoming ? 'status-published' : 'status-cancelled'}`}>
                    {isUpcoming ? 'Upcoming' : 'Past'}
                  </span>
                </div>
                <h2>{event.title}</h2>
                <p className="muted" style={{ margin: '6px 0' }}>
                  {eventDate.toLocaleString()}
                </p>
                <p className="muted" style={{ margin: '6px 0 14px' }}>
                  {event.venue.name} · {event.venue.city}
                </p>
                {lowestPrice !== null && (
                  <p style={{ margin: '0 0 14px' }}>
                    <strong>Tickets from ₹{lowestPrice}</strong>
                  </p>
                )}
                {isUpcoming ? (
                  <Link className="button button-primary" href={`/events/${event.id}`}>
                    View seats & book
                  </Link>
                ) : (
                  <button className="button button-dark" type="button" disabled>
                    Event ended
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
