'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = { name: string; role: string };

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  useEffect(() => { const saved = localStorage.getItem('user'); if (saved) setUser(JSON.parse(saved)); }, []);
  const logout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); router.push('/login'); };
  return <nav className="nav"><div className="nav-inner"><div className="nav-links"><Link href="/" className="brand">SmartVenue <span>Live</span></Link><Link href="/">Events</Link>{user && <Link href="/tickets">My Tickets</Link>}{user && ['Admin', 'Organizer'].includes(user.role) && <Link href="/manage">Manage Venues/Events</Link>}{user && ['Admin', 'GateStaff'].includes(user.role) && <Link href="/gate">Gate Scanner</Link>}{user && ['Admin', 'Organizer', 'Finance'].includes(user.role) && <Link href="/reports">Reports</Link>}</div><div className="nav-user">{user ? <><span className="user-chip">{user.name} · {user.role}</span><button onClick={logout} className="button button-outline">Logout</button></> : <Link href="/login" className="button button-primary">Login / Register</Link>}</div></div></nav>;
}
