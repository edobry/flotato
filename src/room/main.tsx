import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import Host from './Host.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Host />
  </StrictMode>,
);
