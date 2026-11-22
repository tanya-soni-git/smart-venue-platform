'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ManagePage() {
  const [role, setRole] = useState('');
  const [venues, setVenues] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [venueMessage, setVenueMessage] = useState('');
  const [venueError, setVenueError] = useState('');
  const [venue, setVenue] = useState({ name: '', city: '', address: '', rows: 4, cols: 6 });
  const [event, setEvent] = useState<any>({
    title: '',
    category: 'Concert',
    eventDateTime: '',
    venueId: '',
    Platinum: 1500,
    Gold: 1000,
    Silver: 700,
    Accessible: 400
  });

  const refresh = async () => {
    setVenues(await apiFetch('/api/venues'));
    setEvents(await apiFetch('/api/events?all=true'));
  };

  useEffect(() => {
    const saved = localStorage.getItem('user');
    if (saved) setRole(JSON.parse(saved).role);
    refresh();
  }, []);

  const createVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setVenueError('');
    setVenueMessage('');
    try {
      await apiFetch('/api/venues', { method: 'POST', body: JSON.stringify(venue) });
      setVenue({ name: '', city: '', address: '', rows: 4, cols: 6 });
      setVenueMessage('Venue created');
      await refresh();
    } catch (error: any) {
      setVenueError(error.message);
    }
  };

  const deleteVenue = async (id: number) => {
    if (!window.confirm('Delete this venue?')) return;
    setVenueError('');
    setVenueMessage('');
    try {
      await apiFetch(`/api/venues/${id}`, { method: 'DELETE' });
      setVenueMessage('Venue deleted');
      await refresh();
    } catch (error: any) {
      setVenueError(error.message);
    }
  };

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        ...event,
        prices: {
          Platinum: event.Platinum,
          Gold: event.Gold,
          Silver: event.Silver,
          Accessible: event.Accessible
        }
      })
    });
    await refresh();
  };

  const update = async (id: number, action: string) => {
    await apiFetch(`/api/events/${id}/${action}`, { method: 'PATCH' });
    await refresh();
  };

  return (
    <>
      <h1>Manage venues & events</h1>
      <div className="split">
        {role === 'Admin' && (
          <form className="panel form-stack" onSubmit={createVenue}>
            <h2>Register venue</h2>
            {venueError && <div className="alert alert-error">{venueError}</div>}
            {venueMessage && <div className="alert">{venueMessage}</div>}
            {(['name', 'city', 'address'] as const).map((key) => (
              <div className="field-group" key={key}>
                <label className="field-label" htmlFor={`venue-${key}`}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
                <input
                  id={`venue-${key}`}
                  className="field"
                  value={venue[key]}
                  required
                  onChange={(e) => setVenue({ ...venue, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="form-row-2">
              <div className="field-group">
                <label className="field-label" htmlFor="venue-rows">Rows</label>
                <input id="venue-rows" className="field" type="number" min="1" value={venue.rows} onChange={(e) => setVenue({ ...venue, rows: Number(e.target.value) })} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="venue-cols">Columns</label>
                <input id="venue-cols" className="field" type="number" min="1" value={venue.cols} onChange={(e) => setVenue({ ...venue, cols: Number(e.target.value) })} />
              </div>
            </div>
            <button className="button button-dark">Create venue</button>
          </form>
        )}

        <form className="panel form-stack" onSubmit={createEvent}>
          <h2>Create event</h2>
          <input className="field" placeholder="Event title" required onChange={(e) => setEvent({ ...event, title: e.target.value })} />
          <input className="field" placeholder="Category" value={event.category} onChange={(e) => setEvent({ ...event, category: e.target.value })} />
          <input className="field" type="datetime-local" required onChange={(e) => setEvent({ ...event, eventDateTime: e.target.value })} />
          <select className="field" required value={event.venueId} onChange={(e) => setEvent({ ...event, venueId: e.target.value })}>
            <option value="">Select venue</option>
            {venues.map((item) => (
              <option key={item.id} value={item.id}>{item.name} ({item.city})</option>
            ))}
          </select>
          <div className="grid">
            {['Platinum', 'Gold', 'Silver', 'Accessible'].map((tier) => (
              <input className="field" type="number" key={tier} value={event[tier]} onChange={(e) => setEvent({ ...event, [tier]: Number(e.target.value) })} />
            ))}
          </div>
          <button className="button button-success">Save draft event</button>
        </form>
      </div>

      {role === 'Admin' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h2>Manage venues</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>City</th><th>Capacity</th><th>Actions</th></tr></thead>
              <tbody>
                {venues.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.city}</td>
                    <td>{item.capacity}</td>
                    <td><button type="button" className="button button-danger" onClick={() => deleteVenue(item.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Manage events</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Title</th><th>Venue</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {events.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.venue.name}</td>
                  <td>{item.status}</td>
                  <td>
                    {item.status === 'Draft' && <button className="button button-dark" onClick={() => update(item.id, 'publish')}>Publish</button>}
                    {item.status !== 'Cancelled' && <button className="button button-danger" onClick={() => update(item.id, 'cancel')}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
