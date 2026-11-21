import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata = { title: 'SmartVenue Live', description: 'Live Event Ticketing & Venue Management Platform' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Navbar /><main className="container">{children}</main></body></html>;
}
