// Ghost Content API client for Rabar blog
// Replace these values with your actual Ghost credentials

const GHOST_URL = import.meta.env.GHOST_URL || 'https://demo.ghost.io';
const GHOST_KEY = import.meta.env.GHOST_KEY || '22444f78447824223cefc48062'; // Demo key

interface GhostPost {
  id: string;
  slug: string;
  title: string;
  html: string;
  excerpt: string;
  feature_image: string | null;
  published_at: string;
  reading_time: number;
  tags?: { name: string; slug: string }[];
}

interface GhostResponse {
  posts: GhostPost[];
  meta: {
    pagination: {
      page: number;
      limit: number;
      pages: number;
      total: number;
    };
  };
}

export async function getPosts(limit = 10): Promise<GhostPost[]> {
  try {
    const res = await fetch(
      `${GHOST_URL}/ghost/api/content/posts/?key=${GHOST_KEY}&limit=${limit}&include=tags`
    );
    
    if (!res.ok) {
      console.error('Ghost API error:', res.status);
      return getDummyPosts();
    }
    
    const data: GhostResponse = await res.json();
    return data.posts;
  } catch (error) {
    console.error('Failed to fetch Ghost posts:', error);
    return getDummyPosts();
  }
}

export async function getPostBySlug(slug: string): Promise<GhostPost | null> {
  try {
    const res = await fetch(
      `${GHOST_URL}/ghost/api/content/posts/slug/${slug}/?key=${GHOST_KEY}`
    );
    
    if (!res.ok) {
      return getDummyPosts().find(p => p.slug === slug) || null;
    }
    
    const data = await res.json();
    return data.posts[0] || null;
  } catch (error) {
    console.error('Failed to fetch Ghost post:', error);
    return getDummyPosts().find(p => p.slug === slug) || null;
  }
}

// Dummy posts for development/preview
function getDummyPosts(): GhostPost[] {
  return [
    {
      id: '1',
      slug: 'home-assistant-beginnen',
      title: 'Beginnen met Home Assistant: Een complete gids',
      html: '<p>Home Assistant is een krachtig open-source platform voor home automation. In dit artikel leg ik uit hoe je kunt beginnen...</p>',
      excerpt: 'Home Assistant is een krachtig open-source platform voor home automation. Leer hoe je zonder maandelijkse kosten je huis slim maakt.',
      feature_image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
      published_at: '2024-12-15T10:00:00.000Z',
      reading_time: 8,
      tags: [{ name: 'Home Assistant', slug: 'home-assistant' }]
    },
    {
      id: '2',
      slug: 'wifi-thuisnetwerk-optimaliseren',
      title: 'Je WiFi optimaliseren: Tips voor het perfecte thuisnetwerk',
      html: '<p>Een stabiel en snel thuisnetwerk is de basis van elk smart home. Hier zijn mijn beste tips...</p>',
      excerpt: 'Een stabiel thuisnetwerk is de basis van elk smart home. Ontdek hoe je je WiFi optimaliseert voor maximale dekking en snelheid.',
      feature_image: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&q=80',
      published_at: '2024-12-01T10:00:00.000Z',
      reading_time: 5,
      tags: [{ name: 'Netwerk', slug: 'netwerk' }]
    },
    {
      id: '3',
      slug: 'slimme-verlichting-zonder-cloud',
      title: 'Slimme verlichting zonder cloud: lokaal en privé',
      html: '<p>Veel slimme verlichting vereist een cloud-verbinding. Maar dat hoeft niet. Ontdek de alternatieven...</p>',
      excerpt: 'Slimme verlichting hoeft niet via de cloud. Ontdek hoe je lokale controle houdt over je lampen met Zigbee en Home Assistant.',
      feature_image: 'https://images.unsplash.com/photo-1507494924047-60b8ee826ca9?w=800&q=80',
      published_at: '2024-11-20T10:00:00.000Z',
      reading_time: 6,
      tags: [{ name: 'Verlichting', slug: 'verlichting' }]
    }
  ];
}
