import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import Pad from './Pad.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Pad />
  </StrictMode>,
);
