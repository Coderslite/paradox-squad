import type { Metadata, Viewport } from "next";
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Paradox Squad — free multiplayer browser shooter",
    template: "%s · Paradox Squad",
  },
  description:
    "Paradox Squad is a free 2–8 player first-person shooter that runs in your browser. Rewind time, deploy echoes of yourself and fight across colliding eras with friends. No install.",
  applicationName: "Paradox Squad",
  openGraph: {
    type: "website",
    siteName: "Paradox Squad",
    title: "Paradox Squad — free multiplayer browser shooter",
    description: "Rewind time, deploy echoes and fight across colliding eras. Open a link and play with friends.",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#05070a] text-white">{children}</body>
    </html>
  );
}
