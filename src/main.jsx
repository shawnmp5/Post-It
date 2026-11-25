import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './styles.css';

// The interface font is in index.html; the note fonts load after, without holding up the first paint.
const noteFonts = document.createElement('link');
noteFonts.rel = 'stylesheet';
noteFonts.href =
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Caveat:wght@400;700&family=Gochi+Hand&family=Kalam:wght@400;700&family=Patrick+Hand&display=swap';
document.head.appendChild(noteFonts);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
