/**
 * Extracts LinkedIn username from a profile URL.
 * @param profileUrl - The full LinkedIn profile URL
 * @returns The extracted username or null if invalid
 */
export function extractLinkedInUsername(profileUrl: string): string | null {
  try {
    const url = new URL(profileUrl);
    // Match common LinkedIn profile URL patterns:
    // /in/username
    // /in/username/
    // /in/username?somequery
    const pathname = url.pathname;
    const regex = /^\/in\/([a-zA-Z0-9_-]+)/;
    const match = pathname.match(regex);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch (error) {
    console.error('Error parsing profile URL:', error);
    return null;
  }
} 