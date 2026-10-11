import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../src/index.css';

const GA_ID = 'G-5W892DWMHR';
const META_PIXEL_ID = '2117085279684313';

export const metadata: Metadata = {
  title: 'Patente B Italia (বাংলা) | ইতালিয়ান ড্রাইভিং লাইসেন্স কুইজ ও বাংলা ব্যাখ্যা',
  description:
    'ইতালিয়ান ড্রাইভিং লাইসেন্স (Patente B) এর অফিশিয়াল কুইজ বাংলা অনুবাদ ও ব্যাখ্যা সহ অনুশীলন করুন। সিমুলেশন পরীক্ষা, শব্দকোষ ও অডিও উচ্চারণ।',
  applicationName: 'Patente B Italia (বাংলা)',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.png', sizes: '128x128', type: 'image/png' },
    ],
    apple: [{ url: '/favicon.png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

const gaScript = `
window.dataLayer = window.dataLayer || [];
window.gtag = function(){window.dataLayer.push(arguments);};
window.gtag('js', new Date());
window.gtag('config', '${GA_ID}');
`;

const metaPixelScript = `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bn" translate="no" className="notranslate">
      <head>
        <meta name="google" content="notranslate" />
        <meta name="googlebot" content="notranslate" />
        <meta name="robots" content="notranslate" />
        {/* Google tag (gtag.js) - Google Analytics 4 */}
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
        <script dangerouslySetInnerHTML={{ __html: gaScript }} />
        {/* Meta Pixel Code for PatenteGuru */}
        <script dangerouslySetInnerHTML={{ __html: metaPixelScript }} />
      </head>
      <body className="notranslate" translate="no">
        {/* Meta Pixel NoScript Fallback */}
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            alt=""
          />
        </noscript>
        {children}
      </body>
    </html>
  );
}
