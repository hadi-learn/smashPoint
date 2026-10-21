import './globals.css';

export const metadata = {
  title: 'SmashPoint - Multi-Court Scoring Engine',
  description: 'Dedicated multi-court badminton match scoring & display engine',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#070d1f',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
