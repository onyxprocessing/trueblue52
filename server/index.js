import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import session from 'express-session';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'trueamino-session-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// TypeScript compilation middleware
app.use('/src', async (req, res, next) => {
  if (req.url.endsWith('.tsx') || req.url.endsWith('.ts')) {
    try {
      const filePath = join(__dirname, '../client/src', req.url);
      const fs = await import('fs');
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // Simple JSX transform for basic React components
      const transformed = fileContent
        .replace(/import\s+React\s*,?\s*\{[^}]*\}\s+from\s+['"]react['"];?/g, '')
        .replace(/import\s+React\s+from\s+['"]react['"];?/g, '')
        .replace(/export\s+default\s+function\s+(\w+)/g, 'function $1')
        .replace(/export\s+function\s+(\w+)/g, 'function $1')
        .replace(/<(\w+)([^>]*?)>/g, 'React.createElement("$1", {$2}')
        .replace(/<\/(\w+)>/g, ')')
        .replace(/className=/g, 'class=');
      
      res.type('application/javascript');
      res.send(`
        const React = { createElement: (tag, props, ...children) => ({ tag, props, children }) };
        ${transformed}
      `);
    } catch (error) {
      next();
    }
  } else {
    next();
  }
});

// Static files - serve both static assets and client files
app.use(express.static(join(__dirname, '../static')));
app.use(express.static(join(__dirname, '../client')));
app.use('/src', express.static(join(__dirname, '../client/src')));
app.use('/node_modules', express.static(join(__dirname, '../node_modules')));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'TrueAminos server is running' });
});

app.get('/api/products/featured', (req, res) => {
  res.json([
    {
      id: 1,
      name: 'BPC-157',
      category: 'Peptides',
      price: 49.99,
      image: '/images/bpc-157.jpg',
      description: 'Body Protection Compound for research purposes'
    },
    {
      id: 2,
      name: 'TB-500',
      category: 'Peptides',
      price: 89.99,
      image: '/images/tb-500.jpg',
      description: 'Thymosin Beta-4 for research applications'
    }
  ]);
});

app.get('/api/categories', (req, res) => {
  res.json([
    { id: 1, name: 'Peptides', count: 25 },
    { id: 2, name: 'SARMs', count: 18 },
    { id: 3, name: 'Research Chemicals', count: 12 }
  ]);
});

app.get('/api/cart', (req, res) => {
  res.json({
    items: [],
    itemCount: 0,
    subtotal: 0
  });
});

// Catch all for SPA
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`TrueAminos server running on http://${HOST}:${PORT}`);
});