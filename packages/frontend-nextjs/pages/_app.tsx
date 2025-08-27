import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import '../styles/global.css';
import Layout from '../components/Layout';

export default function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return (
    <Layout>
      <Component {...pageProps} />
    </Layout>
  );
}
