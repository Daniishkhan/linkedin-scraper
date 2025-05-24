/**
 * Extracts LinkedIn username from a profile URL.
 * @param url - The full LinkedIn profile URL
 * @returns The extracted username or null if invalid
 */
export function extractLinkedInUsername(url: string): string | null {
  try {
    console.log(`[Username Extraction] Input URL: "${url}"`);
    
    // Remove any trailing slash and convert to lowercase
    let cleanUrl = url.trim().toLowerCase().replace(/\/$/, '');
    
    // Remove common URL prefixes if missing
    if (!cleanUrl.startsWith('http')) {
      if (cleanUrl.startsWith('linkedin.com') || cleanUrl.startsWith('www.linkedin.com')) {
        cleanUrl = 'https://' + cleanUrl;
      }
    }
    
    console.log(`[Username Extraction] Cleaned URL: "${cleanUrl}"`);
    
    // Match various LinkedIn URL patterns
    const patterns = [
      // Standard profile URLs with https://
      /https?:\/\/(www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_]+)/,
      // Profile URLs with additional parameters
      /https?:\/\/(www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_]+)\//,
      // Public profile URLs
      /https?:\/\/(www\.)?linkedin\.com\/pub\/([a-zA-Z0-9\-_]+)/,
      // International LinkedIn domains
      /https?:\/\/[a-zA-Z]{2}\.linkedin\.com\/in\/([a-zA-Z0-9\-_]+)/,
      // Without protocol
      /linkedin\.com\/in\/([a-zA-Z0-9\-_]+)/,
      /linkedin\.com\/in\/([a-zA-Z0-9\-_]+)\//,
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = cleanUrl.match(pattern);
      console.log(`[Username Extraction] Pattern ${i + 1}: ${pattern} -> Match: ${match ? match[2] || match[1] : 'none'}`);
      
      if (match && (match[2] || match[1])) {
        const extractedUsername = match[2] || match[1];
        console.log(`[Username Extraction] ✅ Successfully extracted username: "${extractedUsername}"`);
        return extractedUsername;
      }
    }
    
    // If no pattern matches, check if the input is already just a username
    if (/^[a-zA-Z0-9\-_]+$/.test(url.trim())) {
      const directUsername = url.trim();
      console.log(`[Username Extraction] ✅ Input appears to be direct username: "${directUsername}"`);
      return directUsername;
    }
    
    console.log(`[Username Extraction] ❌ No match found for URL: "${url}"`);
    return null;
  } catch (error) {
    console.error('Error extracting LinkedIn username:', error);
    return null;
  }
} 