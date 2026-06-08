import "./globals.css";
import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

function getPublicSiteUrl() {
  const fallbackUrl = "https://www.plantasa.com.br";
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL || fallbackUrl;
  const urlWithProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  try {
    return new URL(urlWithProtocol).origin;
  } catch {
    return fallbackUrl;
  }
}

const siteUrl = getPublicSiteUrl();
const siteName = "Plantasã";
const siteTitle = "Plantasã | Consultoria agrícola com IA";
const siteDescription =
  "Plantasã oferece consultoria agrícola com inteligência artificial, revisão humana especializada e orientação para agricultura orgânica, manejo de culturas, pragas e doenças.";
const socialImagePath = "/images/plantasa-social-preview.png";
const socialImageUrl = new URL(socialImagePath, siteUrl).toString();
const socialImageAlt =
  "Logo correta da Plantasã e chamada da consultoria agrícola com IA e revisão humana.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteName,
  title: {
    default: siteTitle,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: [{ url: "/images/plantasa-icon.png", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/images/plantasa-icon.png", sizes: "512x512", type: "image/png" }],
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: siteUrl,
    siteName,
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: socialImageUrl,
        width: 1200,
        height: 630,
        alt: socialImageAlt,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: socialImageUrl,
        alt: socialImageAlt,
      },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Navbar />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
