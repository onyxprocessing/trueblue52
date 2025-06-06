import { Product, Category } from "@shared/schema"

// Airtable API key from environment variable
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "patGluqUFquVBabLM.0bfa03c32c10c95942ec14a72b95c7afa9a4910a5ca4c648b22308fa0b86217d"
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appQbeYz1b0YDv6oJ"
const PRODUCTS_TABLE_ID = "tbl4pJbIUvWA53Arr"
const CATEGORIES_TABLE_ID = "tblCategories" // Assuming we'll create this table

interface AirtableRecord<T> {
  id: string
  fields: T
  createdTime: string
}

interface AirtableResponse<T> {
  records: AirtableRecord<T>[]
  offset?: string
}

// Define the field structure from Airtable
// Define an interface for Airtable attachment thumbnails
interface AirtableThumbnails {
  small: { url: string, width: number, height: number }
  large: { url: string, width: number, height: number }
  full: { url: string, width: number, height: number }
}

// Define an interface for Airtable attachment
interface AirtableImage {
  id: string
  url: string
  filename: string
  size: number
  type: string
  width: number
  height: number
  thumbnails: AirtableThumbnails
}

interface AirtableProductFields {
  name?: string
  description?: string
  description2?: string // Additional detailed description
  price?: number // Generic price (now used as price5mg)
  price5mg?: number // Price specific to 5mg weight
  price10mg?: number // Price specific to 10mg weight
  price15mg?: number // Price specific to 15mg weight
  price20mg?: number // Price specific to 20mg weight
  price2mg?: number // Price specific to 2mg weight (if available)
  price750mg?: number // Price specific to 750mg weight (MK-677)
  price100mg?: number // Price specific to 100mg weight (NAD+)
  price500mg?: number // Price specific to 500mg weight (NAD+)
  price1mg?: number // Price specific to 1mg weight
  price30mg?: number // Price specific to 30mg weight
  price300mg?: number // Price specific to 300mg weight
  price600mg?: number // Price specific to 600mg weight
  price1500mg?: number // Price specific to 1500mg weight
  price5000mg?: number // Price specific to 5000mg weight
  categoryId?: number
  image?: AirtableImage[] // Image is an array of attachment objects
  image2?: AirtableImage[] // Certificate of Analysis (old field name)
  COA?: AirtableImage[] // Certificate of Analysis (new field name)
  image3?: AirtableImage[] // Additional product images
  weightOptions?: string[] // Old field - Array of weight options
  weights?: string[] // New field - Multi-select weights field from Airtable
  slug?: string
  inStock?: boolean
  featured?: boolean
  outofstock?: boolean // New field - "Out of Stock" checkbox in Airtable
  id?: number // Using the ID field from Airtable
}

interface AirtableCategoryFields {
  name?: string
  slug?: string
  image?: string // Changed from imageUrl to image
  id?: number
}

// Request queue and rate limiting
class RequestQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private readonly delay = 2000; // 2 seconds between requests

  async add<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      await request();
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }
    }
    this.processing = false;
  }
}

// Global request queue instance
const requestQueue = new RequestQueue();

// Cache with expiry
class Cache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();
  private readonly ttl = 30 * 60 * 1000; // 30 minutes

  set(key: string, data: T): void {
    this.cache.set(key, { data, expiry: Date.now() + this.ttl });
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item || Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  clear(): void {
    this.cache.clear();
  }
}

// Global cache instances
const responseCache = new Cache<any>();

// Track ongoing requests to prevent duplicates
const ongoingRequests = new Map<string, Promise<any>>();

// Generic function to fetch data from Airtable with rate limiting and caching
async function fetchFromAirtable<T>(tableId: string, params: Record<string, string> = {}): Promise<AirtableRecord<T>[]> {
  const cacheKey = `${tableId}:${JSON.stringify(params)}`;
  
  // Check cache first
  const cached = responseCache.get(cacheKey);
  if (cached) {
    console.log(`Using cached data for ${tableId}`);
    return cached;
  }

  // Check if request is already in progress
  if (ongoingRequests.has(cacheKey)) {
    console.log(`Request already in progress for ${tableId}, waiting...`);
    return await ongoingRequests.get(cacheKey);
  }

  const queryParams = new URLSearchParams(params);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${queryParams.toString()}`;
  
  // Create the request promise and store it
  const requestPromise = requestQueue.add(async () => {
    try {
      console.log(`Making single request to ${tableId}`);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as AirtableResponse<T>;
      
      // Cache the result for 30 minutes
      responseCache.set(cacheKey, data.records);
      
      return data.records;
    } catch (error) {
      console.error("Error fetching from Airtable:", error);
      // For rate limiting errors, return empty array instead of throwing
      if (error instanceof Error && (error.message.includes('429') || error.message.includes('Too Many Requests'))) {
        console.log("Rate limited - returning empty array");
        return [];
      }
      throw error;
    } finally {
      // Remove from ongoing requests when done
      ongoingRequests.delete(cacheKey);
    }
  });

  // Store the ongoing request
  ongoingRequests.set(cacheKey, requestPromise);
  
  return await requestPromise;
}

// Helper function to process weight-specific prices from Airtable record
function processProductPrices(record: AirtableRecord<AirtableProductFields>) {
  // Special handling for NAD+ (id: 2) to manually set 100mg and 500mg prices if needed
  let price100mg = record.fields.price100mg;
  let price500mg = record.fields.price500mg;
  
  // Manual fallback for known products if needed
  if ((record.fields.id === 2 && record.fields.name === "NAD+") || 
      (record.fields.name === "NAD+" || record.fields.slug === "nad")) {
    // If the product is NAD+ and prices aren't set, use these defaults
    if (!price100mg) price100mg = 190; // Example price for NAD+ 100mg
    if (!price500mg) price500mg = 750; // Example price for NAD+ 500mg
    // Make sure weightOptions field includes 100mg and 500mg for NAD+ product
    if (!record.fields.weights) {
      record.fields.weights = ["5mg", "10mg", "100mg", "500mg"];
    } else if (Array.isArray(record.fields.weights)) {
      // Make sure the necessary weights are included
      if (!record.fields.weights.includes("100mg")) {
        record.fields.weights.push("100mg");
      }
      if (!record.fields.weights.includes("500mg")) {
        record.fields.weights.push("500mg");
      }
    }
  }
  
  return {
    // Use price5mg if available, otherwise fall back to generic price
    price: record.fields.price5mg ? record.fields.price5mg.toString() : 
           record.fields.price ? record.fields.price.toString() : "0",
    // Include all weight-specific prices
    price5mg: record.fields.price5mg ? record.fields.price5mg.toString() : 
             record.fields.price ? record.fields.price.toString() : "0",
    price10mg: record.fields.price10mg ? record.fields.price10mg.toString() : "0",
    price15mg: record.fields.price15mg ? record.fields.price15mg.toString() : "0",
    price20mg: record.fields.price20mg ? record.fields.price20mg.toString() : "0",
    price2mg: record.fields.price2mg ? record.fields.price2mg.toString() : "0",
    price750mg: record.fields.price750mg ? record.fields.price750mg.toString() : "0",
    price100mg: price100mg ? price100mg.toString() : "0",
    price500mg: price500mg ? price500mg.toString() : "0",
    // New weight-specific prices
    price1mg: record.fields.price1mg ? record.fields.price1mg.toString() : "0",
    price30mg: record.fields.price30mg ? record.fields.price30mg.toString() : "0",
    price300mg: record.fields.price300mg ? record.fields.price300mg.toString() : "0",
    price600mg: record.fields.price600mg ? record.fields.price600mg.toString() : "0",
    price1500mg: record.fields.price1500mg ? record.fields.price1500mg.toString() : "0",
    price5000mg: record.fields.price5000mg ? record.fields.price5000mg.toString() : "0",
  };
}

// Helper function to extract image URL from Airtable image array
function getImageUrlFromAirtable(imageArray?: AirtableImage[]): string | null {
  if (!imageArray || imageArray.length === 0) {
    return null;
  }
  
  const firstImage = imageArray[0];
  if (!firstImage) {
    return null;
  }
  
  let originalUrl: string | null = null;
  
  // Try to get URL from different sources in order of preference
  if (typeof firstImage.url === 'string' && firstImage.url.startsWith('http')) {
    originalUrl = firstImage.url;
  } else if (firstImage.thumbnails?.full?.url) {
    originalUrl = firstImage.thumbnails.full.url;
  } else if (firstImage.thumbnails?.large?.url) {
    originalUrl = firstImage.thumbnails.large.url;
  } else if (firstImage.thumbnails?.small?.url) {
    originalUrl = firstImage.thumbnails.small.url;
  } else if (typeof firstImage === 'string' && (firstImage as string).startsWith('http')) {
    originalUrl = firstImage as string;
  }
  
  // If we found a URL, proxy it through our server to avoid CORS issues
  if (originalUrl) {
    return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
  }
  
  return null;
}

// Fetch all products from Airtable
export async function fetchProducts(): Promise<Product[]> {
  try {
    const records = await fetchFromAirtable<AirtableProductFields>(PRODUCTS_TABLE_ID)
    
    return records.map(record => {
      // Get price data from helper function
      const priceData = processProductPrices(record);
      
      // Handle weight options - use 'weights' field if available, otherwise 'weightOptions'
      const weightOptions = Array.isArray(record.fields.weights) 
        ? record.fields.weights 
        : (Array.isArray(record.fields.weightOptions) ? record.fields.weightOptions : ["5mg"]);
      
      const slug = record.fields.slug || `product-${record.id}`;
      
      return {
        id: record.fields.id || parseInt(record.id.replace('rec', ''), 36),
        name: record.fields.name || "",
        description: record.fields.description || "",
        description2: record.fields.description2 || "",
        ...priceData,
        categoryId: record.fields.categoryId || 1,
        imageUrl: getImageUrlFromAirtable(record.fields.image),
        image2Url: record.fields.COA 
          ? getImageUrlFromAirtable(record.fields.COA) 
          : getImageUrlFromAirtable(record.fields.image2),
        image3Url: getImageUrlFromAirtable(record.fields.image3),
        weightOptions: weightOptions,
        slug: slug,
        inStock: record.fields.outofstock === true ? false : (record.fields.inStock !== undefined ? record.fields.inStock : true),
        featured: record.fields.featured || false,
        outofstock: record.fields.outofstock || false
      };
    })
  } catch (error) {
    console.error("Error fetching products:", error)
    return []
  }
}

// Fetch a specific product by ID
export async function fetchProductById(id: number): Promise<Product | null> {
  try {
    const records = await fetchFromAirtable<AirtableProductFields>(
      PRODUCTS_TABLE_ID,
      { filterByFormula: `{id}=${id}` }
    )
    
    if (records.length === 0) {
      return null
    }
    
    const record = records[0];
    // Get price data from helper function
    const priceData = processProductPrices(record);
    
    // Handle weight options - use 'weights' field if available, otherwise 'weightOptions'
    const weightOptions = Array.isArray(record.fields.weights) 
      ? record.fields.weights 
      : (Array.isArray(record.fields.weightOptions) ? record.fields.weightOptions : ["5mg"]);
    
    const slug = record.fields.slug || `product-${record.id}`;
    
    return {
      id: record.fields.id || parseInt(record.id.replace('rec', ''), 36),
      name: record.fields.name || "",
      description: record.fields.description || "",
      description2: record.fields.description2 || "",
      ...priceData,
      categoryId: record.fields.categoryId || 1,
      imageUrl: getImageUrlFromAirtable(record.fields.image),
      image2Url: record.fields.COA 
        ? getImageUrlFromAirtable(record.fields.COA) 
        : getImageUrlFromAirtable(record.fields.image2),
      image3Url: getImageUrlFromAirtable(record.fields.image3),
      weightOptions: weightOptions,
      slug: slug,
      inStock: record.fields.outofstock === true ? false : (record.fields.inStock !== undefined ? record.fields.inStock : true),
      featured: record.fields.featured || false,
      outofstock: record.fields.outofstock || false
    };
  } catch (error) {
    console.error("Error fetching product by ID:", error)
    return null
  }
}

// Fetch a specific product by slug
export async function fetchProductBySlug(slug: string): Promise<Product | null> {
  try {
    const records = await fetchFromAirtable<AirtableProductFields>(
      PRODUCTS_TABLE_ID,
      { filterByFormula: `{slug}='${slug}'` }
    )
    
    if (records.length === 0) {
      return null
    }
    
    const record = records[0];
    // Get price data from helper function
    const priceData = processProductPrices(record);
    
    // Handle weight options - use 'weights' field if available, otherwise 'weightOptions'
    const weightOptions = Array.isArray(record.fields.weights) 
      ? record.fields.weights 
      : (Array.isArray(record.fields.weightOptions) ? record.fields.weightOptions : ["5mg"]);
    
    const recordSlug = record.fields.slug || `product-${record.id}`;
    
    return {
      id: record.fields.id || parseInt(record.id.replace('rec', ''), 36),
      name: record.fields.name || "",
      description: record.fields.description || "",
      description2: record.fields.description2 || "",
      ...priceData,
      categoryId: record.fields.categoryId || 1,
      imageUrl: getImageUrlFromAirtable(record.fields.image),
      image2Url: record.fields.COA 
        ? getImageUrlFromAirtable(record.fields.COA) 
        : getImageUrlFromAirtable(record.fields.image2),
      image3Url: getImageUrlFromAirtable(record.fields.image3),
      weightOptions: weightOptions,
      slug: recordSlug,
      inStock: record.fields.outofstock === true ? false : (record.fields.inStock !== undefined ? record.fields.inStock : true),
      featured: record.fields.featured || false,
      outofstock: record.fields.outofstock || false
    };
  } catch (error) {
    console.error("Error fetching product by slug:", error)
    return null
  }
}

// Fetch all categories from Airtable
export async function fetchCategories(): Promise<Category[]> {
  try {
    const records = await fetchFromAirtable<AirtableCategoryFields>(CATEGORIES_TABLE_ID)
    
    return records.map(record => ({
      id: record.fields.id || parseInt(record.id.replace('rec', ''), 36),
      name: record.fields.name || "",
      slug: record.fields.slug || "",
      image: record.fields.image || ""
    }))
  } catch (error) {
    console.error("Error fetching categories:", error)
    return []
  }
}

// Fetch products by category
export async function fetchProductsByCategory(categoryId: number): Promise<Product[]> {
  try {
    const records = await fetchFromAirtable<AirtableProductFields>(
      PRODUCTS_TABLE_ID,
      { filterByFormula: `{categoryId}=${categoryId}` }
    )
    
    return records.map(record => {
      // Get price data from helper function
      const priceData = processProductPrices(record);
      
      // Handle weight options - use 'weights' field if available, otherwise 'weightOptions'
      const weightOptions = Array.isArray(record.fields.weights) 
        ? record.fields.weights 
        : (Array.isArray(record.fields.weightOptions) ? record.fields.weightOptions : ["5mg"]);
      
      const slug = record.fields.slug || `product-${record.id}`;
      
      return {
        id: record.fields.id || parseInt(record.id.replace('rec', ''), 36),
        name: record.fields.name || "",
        description: record.fields.description || "",
        description2: record.fields.description2 || "",
        ...priceData,
        categoryId: record.fields.categoryId || 1,
        imageUrl: getImageUrlFromAirtable(record.fields.image),
        image2Url: record.fields.COA 
          ? getImageUrlFromAirtable(record.fields.COA) 
          : getImageUrlFromAirtable(record.fields.image2),
        image3Url: getImageUrlFromAirtable(record.fields.image3),
        weightOptions: weightOptions,
        slug: slug,
        inStock: record.fields.outofstock === true ? false : (record.fields.inStock !== undefined ? record.fields.inStock : true),
        featured: record.fields.featured || false,
        outofstock: record.fields.outofstock || false
      };
    })
  } catch (error) {
    console.error("Error fetching products by category:", error)
    return []
  }
}

// Fetch featured products
export async function fetchFeaturedProducts(): Promise<Product[]> {
  try {
    const records = await fetchFromAirtable<AirtableProductFields>(
      PRODUCTS_TABLE_ID,
      { filterByFormula: `{featured}=TRUE()` }
    )
    
    if (records.length === 0) {
      return []
    }
    
    return records.map(record => {
      // Get price data from helper function
      const priceData = processProductPrices(record);
      
      // Handle weight options - use 'weights' field if available, otherwise 'weightOptions'
      const weightOptions = Array.isArray(record.fields.weights) 
        ? record.fields.weights 
        : (Array.isArray(record.fields.weightOptions) ? record.fields.weightOptions : ["5mg"]);
      
      const slug = record.fields.slug || `product-${record.id}`;
      
      // Handle NAD+ special pricing
      if (record.fields.name === "NAD+" || slug === "nad") {
        if (!weightOptions.includes("100mg")) {
          weightOptions.push("100mg");
        }
        if (!weightOptions.includes("500mg")) {
          weightOptions.push("500mg");
        }
      }
      
      return {
        id: record.fields.id || parseInt(record.id.replace('rec', ''), 36),
        name: record.fields.name || "",
        description: record.fields.description || "",
        description2: record.fields.description2 || "",
        ...priceData,
        categoryId: record.fields.categoryId || 1,
        imageUrl: getImageUrlFromAirtable(record.fields.image),
        image2Url: record.fields.COA 
          ? getImageUrlFromAirtable(record.fields.COA) 
          : getImageUrlFromAirtable(record.fields.image2),
        image3Url: getImageUrlFromAirtable(record.fields.image3),
        weightOptions: weightOptions,
        slug: slug,
        inStock: record.fields.outofstock === true ? false : (record.fields.inStock !== undefined ? record.fields.inStock : true),
        featured: record.fields.featured || false,
        outofstock: record.fields.outofstock || false
      };
    })
  } catch (error) {
    console.error("Error fetching featured products:", error)
    return []
  }
}