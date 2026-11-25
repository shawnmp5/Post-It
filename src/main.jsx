import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import { SharedView } from './share/SharedView.jsx';
import './styles.css';

// The interface font is in index.html; the note fonts load after, without holding up the first paint.
const noteFonts = document.createElement('link');
noteFonts.rel = 'stylesheet';
noteFonts.href =
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Caveat:wght@400;700&family=Gochi+Hand&family=Kalam:wght@400;700&family=Patrick+Hand&display=swap';
document.head.appendChild(noteFonts);

// A share link (/s/<id>#<key>) opens the read-only view; everything else is the app.
const shared = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,32})\/?$/);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {shared ? <SharedView id={shared[1]} rawKey={location.hash.slice(1)} /> : <Root />}
  </StrictMode>,
);
