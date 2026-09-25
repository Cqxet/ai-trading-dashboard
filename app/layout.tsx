import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QuantGemini | JEV Quantitative Trading Terminal",
  description: "Institutional-grade event-driven quantitative trading architecture with JEV market supervisor intelligence and deterministic hard risk engine.",
  keywords: ["Quantitative Trading", "JEV Supervisor", "Binance Spot", "Alpaca", "High Frequency", "Risk Engine"],
  authors: [{ name: "Quantitative Engineering Team" }],
  openGraph: {
    title: "QuantGemini | JEV Quantitative Trading Terminal",
    description: "Multi-tier algorithmic trading engine powered by real-time Binance WebSocket feeds, quantitative feature engine, and deterministic risk controls.",
    type: "website",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
