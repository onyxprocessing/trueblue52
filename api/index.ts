import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import compression from 'compression';

const app = express();

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Security headers
app.use((req: any, res: any, next: any) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// CORS
app.use((req: any, res: any, next: any) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

// Sample data for testing
const sampleProducts = [
  {
    id: 1,
    name: "BPC-157",
    description: "Research peptide for tissue repair studies",
    price: "89.99",
    categoryId: 1,
    imageUrl: "https://via.placeholder.com/300x300",
    inStock: true,
    featured: true
  }
];

const sampleCategories = [
  {
    id: 1,
    name: "Peptides",
    slug: "peptides",
    imageUrl: "https://via.placeholder.com/300x200"
  }
];

// API Routes
app.get('/api/categories', async (req: any, res: any) => {
  try {
    res.json(sampleCategories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/products', async (req: any, res: any) => {
  try {
    res.json(sampleProducts);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/featured', async (req: any, res: any) => {
  try {
    res.json(sampleProducts.filter(p => p.featured));
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ error: 'Failed to fetch featured products' });
  }
});

app.get('/api/products/:id', async (req: any, res: any) => {
  try {
    const productId = parseInt(req.params.id);
    const product = sampleProducts.find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.get('/api/cart', (req: any, res: any) => {
  res.json({
    items: [],
    itemCount: 0,
    subtotal: 0
  });
});

app.get('/api/health', (req: any, res: any) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TrueAminoStore - Research Peptides & SARMs</title>
        <meta name="description" content="Premium research peptides, SARMs, and research supplies for scientific research.">
        <style>
            body { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; }
            .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
            .header { text-align: center; margin-bottom: 3rem; }
            .logo { font-size: 3rem; font-weight: bold; color: #1e293b; margin-bottom: 1rem; }
            .tagline { font-size: 1.2rem; color: #64748b; }
            .nav { display: flex; justify-content: center; gap: 2rem; margin: 2rem 0; }
            .nav a { color: #3b82f6; text-decoration: none; font-weight: 500; }
            .nav a:hover { text-decoration: underline; }
            .feature { background: white; border-radius: 8px; padding: 2rem; margin: 1rem 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .feature h3 { color: #1e293b; margin-bottom: 1rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">TrueAminoStore</div>
                <div class="tagline">Premium Research Peptides & SARMs</div>
            </div>
            
            <div class="nav">
                <a href="/api/products">View Products</a>
                <a href="/api/categories">Categories</a>
                <a href="/api/health">System Status</a>
            </div>
            
            <div class="feature">
                <h3>Research-Grade Quality</h3>
                <p>All products come with Certificate of Analysis (COA) ensuring purity and quality for research purposes.</p>
            </div>
            
            <div class="feature">
                <h3>Fast Shipping</h3>
                <p>Quick processing and reliable shipping to support your research timeline.</p>
            </div>
            
            <div class="feature">
                <h3>Expert Support</h3>
                <p>Technical support team available to assist with product selection and research applications.</p>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Error handling
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;