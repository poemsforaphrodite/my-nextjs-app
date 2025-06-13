import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Python Documentation Generator",
  description: "Generate comprehensive documentation for Python files using AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Script data-collect-dnt="true" async src="https://scripts.simpleanalyticscdn.com/latest.js" strategy="afterInteractive" />
        <noscript><img src="https://queue.simpleanalyticscdn.com/noscript.gif?collect-dnt=true" alt="" referrerPolicy="no-referrer-when-downgrade"/></noscript>
      </body>
    </html>
  );
}
