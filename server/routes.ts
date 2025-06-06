import type { Express, Request as ExpressRequest, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCartItemSchema, Product } from "@shared/schema";
import { z } from "zod";
import * as expressSession from 'express-session';
import MemoryStore from 'memorystore';
import fetch from 'node-fetch';
import path from 'path';
import { recordPaymentToAirtable } from './airtable-orders';
import { recordPaymentToDatabase } from './db-orders';
import { getAllOrders, getOrderById, countOrders, searchOrders } from './db-query';
import { validateAffiliateCode, addAffiliateCodeToSession } from './affiliate-codes';
import { createPaymentIntent, confirmPayment } from './stripe-controller';

// Define a new type that extends Express Request to include session
interface Request extends ExpressRequest {
  session: {
    id: string;
    cookie: any;
    regenerate: (callback: (err?: any) => void) => void;
    destroy: (callback: (err?: any) => void) => void;
    reload: (callback: (err?: any) => void) => void;
    save: (callback: (err?: any) => void) => void;
    touch: (callback: (err?: any) => void) => void;
  };
}

// Helper function to get the correct price based on selected weight
function getPriceByWeight(product: Product, selectedWeight: string | null): number {
  if (!selectedWeight) {
    return parseFloat(product.price || "0");
  }
  
  // Use dynamic property access with template literal to simplify code and catch all cases
  const priceKey = `price${selectedWeight}` as keyof Product;
  if (product[priceKey]) {
    // If we found a matching price field, use it
    return parseFloat(product[priceKey] as string);
  }
  
  // Manual specific checks for common weights as fallback
  if (selectedWeight === "2mg" && product.price2mg) {
    return parseFloat(product.price2mg);
  } else if (selectedWeight === "5mg" && product.price5mg) {
    return parseFloat(product.price5mg);
  } else if (selectedWeight === "10mg" && product.price10mg) {
    return parseFloat(product.price10mg);
  } else if (selectedWeight === "15mg" && product.price15mg) {
    return parseFloat(product.price15mg);
  } else if (selectedWeight === "20mg" && product.price20mg) {
    return parseFloat(product.price20mg);
  } else if (selectedWeight === "30mg" && product.price30mg) {
    return parseFloat(product.price30mg);
  } else if (selectedWeight === "100mg" && product.price100mg) {
    return parseFloat(product.price100mg);
  } else if (selectedWeight === "300mg" && product.price300mg) {
    return parseFloat(product.price300mg);
  } else if (selectedWeight === "500mg" && product.price500mg) {
    return parseFloat(product.price500mg);
  } else if (selectedWeight === "600mg" && product.price600mg) {
    return parseFloat(product.price600mg);
  } else if (selectedWeight === "750mg" && product.price750mg) {
    return parseFloat(product.price750mg);
  } else if (selectedWeight === "1mg" && product.price1mg) {
    return parseFloat(product.price1mg);
  } else if (selectedWeight === "1500mg" && product.price1500mg) {
    return parseFloat(product.price1500mg);
  } else if (selectedWeight === "5000mg" && product.price5000mg) {
    return parseFloat(product.price5000mg);
  }
  
  // Fallback to the default price if no specific price field found
  return parseFloat(product.price || "0");
}

// Helper function removed - directly using fetch in the endpoint

export async function registerRoutes(app: Express): Promise<Server> {
  // No Stripe initialization - using direct payment methods instead
  // Set up session middleware for cart management
  const MemoryStoreSession = MemoryStore(expressSession);
  app.use(expressSession.default({
    secret: 'trueaminos-secret-key',
    resave: false,
    saveUninitialized: true,
    store: new MemoryStoreSession({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Allow cookies to be sent in cross-site requests
      httpOnly: true,  // Prevent client-side JavaScript access
      maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
    }
  }));
  
  // Add CORS headers for all requests
  app.use((req, res, next) => {
    // Get the origin from the request header or use * as a fallback
    const origin = req.headers.origin || '*';
    
    // Allow the specific origin that sent the request or all origins if not specified
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

  // Image proxy and optimization endpoint
  app.get("/api/image-proxy", async (req: Request, res: Response) => {
    // Forward to the image optimizer service
    const { optimizeAndServeImage } = await import('./image-optimizer');
    await optimizeAndServeImage(req, res);
  });

  // API Routes - all prefixed with /api
  
  // Categories
  app.get("/api/categories", async (_req: Request, res: Response) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.get("/api/categories/:slug", async (req: Request, res: Response) => {
    try {
      const category = await storage.getCategoryBySlug(req.params.slug);
      
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      res.json(category);
    } catch (error) {
      console.error(`Error fetching category ${req.params.slug}:`, error);
      res.status(500).json({ message: "Failed to fetch category" });
    }
  });

  // Products
  app.get("/api/products", async (_req: Request, res: Response) => {
    try {
      const products = await storage.getProducts();
      res.json(products);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/featured", async (_req: Request, res: Response) => {
    try {
      const products = await storage.getFeaturedProducts();
      res.json(products);
    } catch (error) {
      console.error("Error fetching featured products:", error);
      res.status(500).json({ message: "Failed to fetch featured products" });
    }
  });

  app.get("/api/products/category/:categoryId", async (req: Request, res: Response) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      const products = await storage.getProductsByCategory(categoryId);
      res.json(products);
    } catch (error) {
      console.error(`Error fetching products for category ${req.params.categoryId}:`, error);
      res.status(500).json({ message: "Failed to fetch products for category" });
    }
  });

  app.get("/api/products/:slug", async (req: Request, res: Response) => {
    try {
      const product = await storage.getProductBySlug(req.params.slug);
      
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Special handling for NAD+ product
      if (req.params.slug === "nad+") {
        // If NAD+ doesn't have a COA, fetch it from another product
        if (!product.image2Url) {
          const bpcProduct = await storage.getProductBySlug("bpc-157");
          if (bpcProduct && bpcProduct.image2Url) {
            product.image2Url = bpcProduct.image2Url;
          }
        }
      }
      
      res.json(product);
    } catch (error) {
      console.error(`Error fetching product ${req.params.slug}:`, error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  // Cart
  app.get("/api/cart", async (req: Request, res: Response) => {
    try {
      const sessionId = req.session.id;
      const cartItems = await storage.getCartItems(sessionId);
      
      // Calculate totals
      const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
      const subtotal = cartItems.reduce((sum, item) => sum + getPriceByWeight(item.product, item.selectedWeight) * item.quantity, 0);
      
      res.json({
        items: cartItems,
        itemCount,
        subtotal
      });
    } catch (error) {
      console.error("Error fetching cart:", error);
      res.status(500).json({ message: "Failed to fetch cart" });
    }
  });

  app.post("/api/cart", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const validationResult = insertCartItemSchema
        .omit({ id: true })
        .safeParse({
          ...req.body,
          sessionId: req.session.id
        });
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body",
          errors: validationResult.error.errors
        });
      }
      
      const cartItem = validationResult.data;
      
      // Check if product exists
      const product = await storage.getProductById(cartItem.productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Add to cart
      const addedItem = await storage.addToCart(cartItem);
      
      // Check if there's an affiliate code in the session and save it to Airtable cart record
      const session = req.session as any;
      if (session.discountInfo && session.discountInfo.code) {
        try {
          const { addAffiliateCodeToSession } = await import('./affiliate-codes');
          await addAffiliateCodeToSession(req.session.id, session.discountInfo.code);
        } catch (error) {
          console.error('Error adding affiliate code to cart record:', error);
        }
      }
      
      // Get updated cart
      const updatedCart = await storage.getCartItems(req.session.id);
      const itemCount = updatedCart.reduce((sum, item) => sum + item.quantity, 0);
      const subtotal = updatedCart.reduce((sum, item) => sum + getPriceByWeight(item.product, item.selectedWeight) * item.quantity, 0);
      
      res.status(201).json({
        addedItem,
        cart: {
          items: updatedCart,
          itemCount,
          subtotal
        }
      });
    } catch (error) {
      console.error("Error adding to cart:", error);
      res.status(500).json({ message: "Failed to add item to cart" });
    }
  });

  app.put("/api/cart/:id", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const quantitySchema = z.object({ quantity: z.number().int().positive() });
      const validationResult = quantitySchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body",
          errors: validationResult.error.errors
        });
      }
      
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid cart item ID" });
      }
      
      const { quantity } = validationResult.data;
      
      // Update cart item
      const updatedItem = await storage.updateCartItem(id, quantity);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      
      // Get updated cart
      const updatedCart = await storage.getCartItems(req.session.id);
      const itemCount = updatedCart.reduce((sum, item) => sum + item.quantity, 0);
      const subtotal = updatedCart.reduce((sum, item) => sum + getPriceByWeight(item.product, item.selectedWeight) * item.quantity, 0);
      
      res.json({
        updatedItem,
        cart: {
          items: updatedCart,
          itemCount,
          subtotal
        }
      });
    } catch (error) {
      console.error(`Error updating cart item ${req.params.id}:`, error);
      res.status(500).json({ message: "Failed to update cart item" });
    }
  });

  app.delete("/api/cart/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid cart item ID" });
      }
      
      // Remove cart item
      const removed = await storage.removeCartItem(id);
      
      if (!removed) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      
      // Get updated cart
      const updatedCart = await storage.getCartItems(req.session.id);
      const itemCount = updatedCart.reduce((sum, item) => sum + item.quantity, 0);
      const subtotal = updatedCart.reduce((sum, item) => sum + getPriceByWeight(item.product, item.selectedWeight) * item.quantity, 0);
      
      res.json({
        success: true,
        cart: {
          items: updatedCart,
          itemCount,
          subtotal
        }
      });
    } catch (error) {
      console.error(`Error removing cart item ${req.params.id}:`, error);
      res.status(500).json({ message: "Failed to remove cart item" });
    }
  });

  app.delete("/api/cart", async (req: Request, res: Response) => {
    try {
      // Clear cart
      await storage.clearCart(req.session.id);
      
      res.json({
        success: true,
        cart: {
          items: [],
          itemCount: 0,
          subtotal: 0
        }
      });
    } catch (error) {
      console.error("Error clearing cart:", error);
      res.status(500).json({ message: "Failed to clear cart" });
    }
  });

  // Affiliate code validation endpoint
  app.post("/api/affiliate-code/validate", async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({ 
          success: false, 
          message: "Affiliate code is required" 
        });
      }
      
      const result = await validateAffiliateCode(code);
      
      if (result.valid) {
        // If the code is valid, store it in the session
        if (req.session && req.session.id) {
          await addAffiliateCodeToSession(req.session.id, result.code);
        }
        
        return res.status(200).json({ 
          success: true, 
          message: `Valid affiliate code! ${result.discount}% discount applied.`,
          data: {
            code: result.code,
            discount: result.discount,
            name: result.name
          }
        });
      } else {
        return res.status(200).json({ 
          success: false, 
          message: "Invalid affiliate code",
          data: {
            code: result.code,
            discount: 0,
            name: ""
          }
        });
      }
    } catch (error) {
      console.error("Error validating affiliate code:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Error validating affiliate code" 
      });
    }
  });
  
  // Contact form submission route
  app.post("/api/contact", async (req: Request, res: Response) => {
    try {
      const { name, email, subject, message, type } = req.body;
      
      // For newsletter subscriptions, we only require email
      if (type === "newsletter") {
        if (!email) {
          return res.status(400).json({ 
            success: false, 
            message: "Email is required for newsletter subscription" 
          });
        }
      } else {
        // Regular contact form submission requires all fields
        if (!name || !email || !subject || !message) {
          return res.status(400).json({ 
            success: false, 
            message: "All fields are required" 
          });
        }
      }
      
      // Submit to Airtable - use the same credentials we're using for products
      const airtableApiKey = process.env.AIRTABLE_API_KEY || "patGluqUFquVBabLM.0bfa03c32c10c95942ec14a72b95c7afa9a4910a5ca4c648b22308fa0b86217d";
      const airtableBaseId = "app3XDDBbU0ZZDBiY";
      const tableId = "tblbkB8ikiImA7q67"; // Contact form table ID
      
      const airtableUrl = `https://api.airtable.com/v0/${airtableBaseId}/${tableId}`;
      
      const response = await fetch(airtableUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${airtableApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            name,
            email,
            subject,
            message,
            type: type || "contact" // Add the type field with a default of "contact"
          }
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Airtable API error:", errorData);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to submit form to Airtable" 
        });
      }
      
      const data = await response.json();
      
      return res.status(200).json({ 
        success: true, 
        message: "Contact form submitted successfully",
        data
      });
    } catch (error) {
      console.error("Error submitting contact form:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Error submitting contact form" 
      });
    }
  });

  // Order management endpoints
  app.get("/api/orders", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const search = req.query.search as string;
      
      if (search) {
        const orders = await searchOrders(search, limit, offset);
        res.json(orders);
      } else {
        const orders = await getAllOrders(limit, offset);
        res.json(orders);
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });
  
  app.get("/api/orders/count", async (_req: Request, res: Response) => {
    try {
      const count = await countOrders();
      res.json({ count });
    } catch (error) {
      console.error("Error counting orders:", error);
      res.status(500).json({ message: "Failed to count orders" });
    }
  });
  
  app.get("/api/orders/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }
      
      const order = await getOrderById(id);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      res.json(order);
    } catch (error) {
      console.error(`Error fetching order ${req.params.id}:`, error);
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });

  // Direct Payment Processing
  // These endpoints are replaced by the multi-step checkout flow
  // which handles all payment methods through the checkout-flow.ts module
  
  // Calculate cart total endpoint for display purposes only
  app.post("/api/calculate-cart-total", async (req: Request, res: Response) => {
    try {
      const sessionId = req.session.id;
      const cartItems = await storage.getCartItems(sessionId);
      
      if (!cartItems || cartItems.length === 0) {
        return res.status(400).json({ message: "Your cart is empty" });
      }
      
      // Calculate total
      const amount = cartItems.reduce((sum, item) => {
        return sum + (getPriceByWeight(item.product, item.selectedWeight) * item.quantity);
      }, 0);
      
      if (amount <= 0) {
        return res.status(400).json({ message: "Invalid cart total" });
      }
      
      // Send amount back to client
      res.json({
        amount: amount,
        itemCount: cartItems.length
      });
    } catch (error: any) {
      console.error('Error calculating cart total:', error);
      res.status(500).json({ message: `Error calculating total: ${error.message}` });
    }
  });
  
  // New multi-step checkout endpoints
  
  // Step 1: Personal information (name, email, phone)
  app.post('/api/checkout/personal-info', async (req: Request, res: Response) => {
    const { handlePersonalInfo } = await import('./checkout-flow');
    await handlePersonalInfo(req, res);
  });
  
  // Step 2: Shipping information (address, city, state, zip, shipping method)
  app.post('/api/checkout/shipping-info', async (req: Request, res: Response) => {
    const { handleShippingInfo } = await import('./checkout-flow');
    await handleShippingInfo(req, res);
  });
  
  // Step 3: Payment method selection (card, bank, crypto)
  app.post('/api/checkout/payment-method', async (req: Request, res: Response) => {
    const { handlePaymentMethod } = await import('./checkout-flow');
    await handlePaymentMethod(req, res);
  });
  
  // Step 4: Payment confirmation (for bank and crypto)
  app.post('/api/checkout/confirm-payment', async (req: Request, res: Response) => {
    const { handlePaymentConfirmation } = await import('./checkout-flow');
    await handlePaymentConfirmation(req, res);
  });
  
  // Stripe payment routes
  app.post('/api/create-payment-intent', createPaymentIntent);
  app.post('/api/confirm-payment', confirmPayment);
  
  // FedEx address validation endpoint
  app.post('/api/validate-address', async (req: Request, res: Response) => {
    try {
      const { validateAddress } = await import('./fedex-address-validation');
      
      const { 
        streetLine1, 
        streetLine2, 
        city, 
        state, 
        zipCode, 
        country = 'US' 
      } = req.body;
      
      // Validate address using FedEx API
      const validationResult = await validateAddress({
        streetLine1,
        streetLine2,
        city,
        state,
        zipCode,
        country
      });
      
      if (!validationResult) {
        return res.status(500).json({ 
          success: false, 
          message: "Address validation service unavailable" 
        });
      }
      
      res.json({
        success: true,
        validation: validationResult
      });
    } catch (error: any) {
      console.error('Error validating address:', error);
      res.status(500).json({ 
        success: false, 
        message: `Error validating address: ${error.message}` 
      });
    }
  });
  
  // Flat rate shipping API endpoint
  app.post('/api/shipping-rates', async (req: Request, res: Response) => {
    try {
      // Get cart items to determine the shipping rate
      const sessionId = req.session.id;
      const cartItems = await storage.getCartItems(sessionId);
      console.log(`Found ${cartItems?.length || 0} cart items for session ${sessionId}`);
      
      if (!cartItems || cartItems.length === 0) {
        console.warn('Cart is empty for shipping rate request');
        return res.status(400).json({ 
          success: false, 
          message: 'Your cart is empty'
        });
      }
      
      // Calculate total item quantity
      const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
      console.log(`Total item quantity: ${totalQuantity}`);
      
      // Determine flat rate shipping based on item quantity
      // $9.99 for 1-5 items, $25 for more than 5 items
      const shippingPrice = totalQuantity > 5 ? 25.00 : 9.99;
      
      // Create a single flat rate shipping option
      const flatRateShipping = {
        serviceType: 'USPS_FLAT_RATE',
        serviceName: 'Standard Shipping via USPS',
        transitTime: '1-2 business days',
        price: shippingPrice,
        currency: 'USD',
        isFlatRate: true
      };
      
      console.log(`Using flat rate shipping: $${shippingPrice.toFixed(2)}`);
      
      res.json({
        success: true,
        rates: [flatRateShipping],
        isFlatRate: true
      });
    } catch (error: any) {
      console.error('Error getting shipping rates:', error);
      res.status(500).json({ 
        success: false,
        message: `Error retrieving shipping rates: ${error.message}`
      });
    }
  });

  // Start checkout process and get ID
  app.post('/api/checkout/initialize', async (req: Request, res: Response) => {
    try {
      const { initializeCheckout } = await import('./checkout-flow');
      const checkoutId = await initializeCheckout(req);
      
      if (!checkoutId) {
        return res.status(500).json({ message: "Failed to initialize checkout" });
      }
      
      // Get cart items for summary
      const cartItems = await storage.getCartItems(req.session.id);
      
      res.json({
        success: true,
        checkoutId,
        cartItemCount: cartItems.length,
        nextStep: 'personal_info'
      });
    } catch (error: any) {
      console.error('Error initializing checkout:', error);
      res.status(500).json({ 
        message: "Error initializing checkout process", 
        error: error.message 
      });
    }
  });
  
  // Add endpoint to save checkout success data to Airtable test field
  app.post('/api/checkout/success-data', async (req: Request, res: Response) => {
    try {
      const { handleCheckoutSuccessData } = await import('./checkout-success');
      await handleCheckoutSuccessData(req, res);
    } catch (error: any) {
      console.error('Error handling checkout success data:', error);
      res.status(500).json({ 
        success: false,
        message: "Error saving checkout success data", 
        error: error.message 
      });
    }
  });
  
  // Affiliate code validation endpoint
  app.post('/api/affiliate-code/validate', async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'No affiliate code provided'
        });
      }
      
      console.log('Validating affiliate code:', code);
      
      const validationResult = await validateAffiliateCode(code);
      
      if (validationResult.valid) {
        // If code is valid, directly update Airtable with the affiliate code
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const airtableBaseId = process.env.AIRTABLE_BASE_ID || "appQbeYz1b0YDv6oJ";
        const tableId = "tblhjfzTX2zjf22s1"; // Cart sessions table ID
        const sessionId = req.session.id;
        
        console.log(`DIRECT API CALL: Adding affiliate code ${validationResult.code} to session ${sessionId}`);
        
        // First, check if session record exists (using exact field name "session id" with space as in Airtable)
        const searchResponse = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${tableId}?filterByFormula=%7Bsession+id%7D%3D%22${encodeURIComponent(sessionId)}%22`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${airtableApiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!searchResponse.ok) {
          console.error('Error searching for session in Airtable:', await searchResponse.text());
        } else {
          const searchData = await searchResponse.json();
          console.log('Search results for session in Airtable:', JSON.stringify(searchData, null, 2));
          
          let updateSuccess = false;
          
          if (searchData.records && searchData.records.length > 0) {
            // Session record exists, update it
            const recordId = searchData.records[0].id;
            
            // Update specifically using "affiliatecode" field
            const updateResponse = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${tableId}/${recordId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${airtableApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                fields: {
                  "affiliatecode": validationResult.code  // Using "affiliatecode" as it's the correct field name in Airtable
                }
              })
            });
            
            if (updateResponse.ok) {
              const updateData = await updateResponse.json();
              console.log('Successfully updated affiliate code in Airtable:', JSON.stringify(updateData, null, 2));
              updateSuccess = true;
            } else {
              console.error('Error updating affiliate code in Airtable:', await updateResponse.text());
            }
          } else {
            // Create new session record with affiliate code
            const createResponse = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${tableId}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${airtableApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                records: [{
                  fields: {
                    "session id": sessionId,
                    "affiliatecode": validationResult.code  // Using "affiliatecode" as it's the correct field name in Airtable
                  }
                }]
              })
            });
            
            if (createResponse.ok) {
              const createData = await createResponse.json();
              console.log('Successfully created new record with affiliate code in Airtable:', JSON.stringify(createData, null, 2));
              updateSuccess = true;
            } else {
              console.error('Error creating new record with affiliate code in Airtable:', await createResponse.text());
            }
          }
          
          if (!updateSuccess) {
            console.error('Failed to update Airtable with affiliate code directly. Trying normal method...');
            await addAffiliateCodeToSession(req.session.id, validationResult.code);
          }
        }
        
        // Store in session for local reference
        req.session.discountInfo = {
          code: validationResult.code,
          percentage: validationResult.discount
        };
        
        // Save session to ensure it persists
        req.session.save((err) => {
          if (err) {
            console.error('Error saving session:', err);
          } else {
            console.log('✅ Session saved with affiliate code:', validationResult.code);
          }
        });
        
        return res.json({
          success: true,
          message: `Discount code "${validationResult.code}" applied successfully for ${validationResult.discount}% off`,
          data: validationResult
        });
      } else {
        return res.json({
          success: false,
          message: 'Invalid discount code. Please try another code.',
          data: validationResult
        });
      }
    } catch (error: any) {
      console.error('Error validating affiliate code:', error);
      return res.status(500).json({
        success: false,
        message: 'Error validating affiliate code',
        error: error.message
      });
    }
  });

  // Affiliate URL validation endpoint for custom links like /jack, /mike, etc.
  app.get('/api/affiliate/validate/:code', async (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      
      if (!code) {
        return res.status(400).json({
          valid: false,
          message: 'No affiliate code provided'
        });
      }
      
      console.log('Validating affiliate URL code:', code);
      
      const validationResult = await validateAffiliateCode(code);
      
      if (validationResult.valid) {
        // Store in session for local reference
        if (!req.session.discountInfo) {
          req.session.discountInfo = {
            code: validationResult.code,
            percentage: validationResult.discount
          };
        }
        
        // Add to Airtable session tracking
        await addAffiliateCodeToSession(req.session.id, validationResult.code);
        
        return res.json({
          valid: true,
          code: validationResult.code,
          discount: validationResult.discount,
          name: validationResult.name,
          message: `Welcome! ${validationResult.discount}% discount applied with code ${validationResult.code}`
        });
      } else {
        return res.json({
          valid: false,
          code: code,
          discount: 0,
          message: 'This affiliate link is not valid'
        });
      }
    } catch (error: any) {
      console.error('Error validating affiliate URL code:', error);
      return res.status(500).json({
        valid: false,
        message: 'Error validating affiliate code',
        error: error.message
      });
    }
  });

  // Add a direct Airtable endpoint specifically for creating records with test field
  app.post('/api/airtable/direct-order', async (req: Request, res: Response) => {
    try {
      console.log('🔍 Direct Airtable order endpoint called with data');
      
      // Import our direct Airtable module
      const { createOrderWithTestData } = await import('./direct-airtable');
      
      // Create the record directly in Airtable
      const recordId = await createOrderWithTestData(req.body);
      
      if (recordId) {
        console.log('✅ Direct Airtable order created with ID:', recordId);
        res.status(201).json({
          success: true,
          recordId
        });
      } else {
        console.error('❌ Failed to create direct Airtable order');
        res.status(500).json({
          success: false,
          message: 'Failed to create Airtable record'
        });
      }
    } catch (error: any) {
      console.error('Error in direct Airtable order route:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error processing direct Airtable order'
      });
    }
  });
  
  // No webhook or external payment service integration is needed
  // Our multi-step checkout flow handles everything through direct form submission
  app.post('/api/webhook', async (req: Request, res: Response) => {
    // This is just a placeholder in case external systems still try to send webhooks
    console.log('Received webhook - ignoring as direct payment processing is used');
    return res.json({ received: true, message: 'Webhooks are not used in the direct payment version' });
  });
  
  // Admin API endpoints are defined here
  
  // Optimized image proxy endpoint for better performance
  app.get('/api/image-optimize', async (req, res) => {
    try {
      // Using dynamic import instead of require since we're in an ESM context
      const imageOptimizer = await import('./image-optimizer');
      return imageOptimizer.optimizeAndServeImage(req, res);
    } catch (error) {
      console.error('Error loading image optimizer:', error);
      return res.status(500).json({ message: 'Image optimization failed' });
    }
  });
  
  // Robots.txt route with proper content type
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(process.cwd(), 'public', 'robots.txt'));
  });
  
  // Sitemap.xml route with proper content type
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml');
    res.sendFile(path.join(process.cwd(), 'public', 'sitemap.xml'));
  });
  
  // Initialize HTTP server
  const httpServer = createServer(app);
  
  // Configure server events
  httpServer.on('close', () => {
    console.log('Server shutting down');
  });
  
  return httpServer;
}