import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, X, Globe, Film, MapPin, ExternalLink } from "lucide-react";

export type DistributorCategory = "major" | "mini_major" | "indie" | "streaming" | "boutique" | "sales_agent" | "aggregator";

export interface Distributor {
  id: string;
  name: string;
  category: DistributorCategory;
  description: string;
  genres: string[];
  budgetRange: [number, number];
  releaseModel: "theatrical" | "hybrid" | "streaming";
  territories: string[];
  submissionType: string;
  contactPathway: string;
  preferredMaterials: string[];
  exampleFilms: string[];
  channels: string[];
  website: string;
}

const CATEGORY_LABELS: Record<DistributorCategory, string> = {
  major: "Major Studio",
  mini_major: "Mini-Major",
  indie: "Independent",
  streaming: "Streaming",
  boutique: "Boutique",
  sales_agent: "Sales Agent",
  aggregator: "Aggregator",
};

export const DISTRIBUTORS: Distributor[] = [
  // Indie
  { id: "a24", name: "A24", category: "indie", description: "Acclaimed independent studio known for bold, artistic films across genres.", genres: ["Drama", "Horror", "Sci-Fi", "Comedy"], budgetRange: [0.5, 20], releaseModel: "theatrical", territories: ["North America", "International"], submissionType: "Agent submission", contactPathway: "Via representation or festival premiere", preferredMaterials: ["screenplay", "pitch-deck", "lookbook"], exampleFilms: ["Everything Everywhere All at Once", "Moonlight", "Hereditary"], channels: ["Theatrical", "Apple TV+"], website: "https://a24films.com" },
  { id: "neon", name: "NEON", category: "indie", description: "Distributor focused on provocative, auteur-driven cinema.", genres: ["Drama", "Thriller", "Documentary"], budgetRange: [0.3, 15], releaseModel: "theatrical", territories: ["North America"], submissionType: "Festival acquisition", contactPathway: "Festival premiere or agent intro", preferredMaterials: ["screenplay", "director-statement", "lookbook"], exampleFilms: ["Parasite", "Anatomy of a Fall", "Triangle of Sadness"], channels: ["Theatrical"], website: "https://neonrated.com" },
  { id: "bleecker", name: "Bleecker Street", category: "indie", description: "Independent distributor specializing in character-driven narratives and prestige releases.", genres: ["Drama", "Biography", "Comedy"], budgetRange: [1, 15], releaseModel: "theatrical", territories: ["North America"], submissionType: "Agent submission", contactPathway: "Through representation", preferredMaterials: ["screenplay", "pitch-deck"], exampleFilms: ["Trumbo", "Ordinary Angels"], channels: ["Theatrical", "VOD"], website: "https://bleeckerstreetmedia.com" },
  // Streaming
  { id: "netflix", name: "Netflix", category: "streaming", description: "Global streaming platform producing and acquiring content at scale.", genres: ["All genres"], budgetRange: [1, 200], releaseModel: "streaming", territories: ["Global"], submissionType: "Agent/producer submission", contactPathway: "Through representation", preferredMaterials: ["screenplay", "pitch-deck", "sizzle-reel"], exampleFilms: ["Glass Onion", "All Quiet on the Western Front", "The Power of the Dog"], channels: ["Streaming"], website: "https://netflix.com" },
  { id: "amazon-mgm", name: "Amazon MGM Studios", category: "streaming", description: "Amazon's film studio producing theatrical and streaming releases.", genres: ["All genres"], budgetRange: [5, 150], releaseModel: "hybrid", territories: ["Global"], submissionType: "Agent submission", contactPathway: "Through representation", preferredMaterials: ["screenplay", "pitch-deck", "sizzle-reel"], exampleFilms: ["The Idea of You", "Air", "Saltburn"], channels: ["Theatrical", "Prime Video"], website: "https://www.amazonmgmstudios.com" },
  { id: "mubi", name: "MUBI", category: "streaming", description: "Curated streaming platform and distributor of international arthouse cinema.", genres: ["Drama", "Art House", "Foreign Language"], budgetRange: [0.1, 10], releaseModel: "hybrid", territories: ["Global"], submissionType: "Festival acquisition", contactPathway: "Festival premiere", preferredMaterials: ["screener", "press-kit"], exampleFilms: ["Aftersun", "Decision to Leave"], channels: ["Streaming", "Theatrical"], website: "https://mubi.com" },
  // Mini-Major
  { id: "searchlight", name: "Searchlight Pictures", category: "mini_major", description: "Disney-owned label for prestige and awards-oriented films.", genres: ["Drama", "Comedy", "Biography"], budgetRange: [5, 40], releaseModel: "theatrical", territories: ["Global"], submissionType: "Agent submission", contactPathway: "Major agency representation required", preferredMaterials: ["screenplay", "pitch-deck"], exampleFilms: ["The Shape of Water", "Nomadland", "Poor Things"], channels: ["Theatrical", "Hulu"], website: "https://www.searchlightpictures.com" },
  { id: "focus", name: "Focus Features", category: "mini_major", description: "NBCUniversal's specialty label for original, daring films.", genres: ["Drama", "Thriller", "Comedy", "Romance"], budgetRange: [3, 30], releaseModel: "theatrical", territories: ["Global"], submissionType: "Agent submission", contactPathway: "Major agency representation", preferredMaterials: ["screenplay", "pitch-deck"], exampleFilms: ["Promising Young Woman", "Tár", "The Holdovers"], channels: ["Theatrical", "Peacock"], website: "https://www.focusfeatures.com" },
  // Boutique
  { id: "ifc", name: "IFC Films", category: "boutique", description: "Long-running indie distributor with day-and-date release model.", genres: ["Drama", "Horror", "Comedy", "Documentary"], budgetRange: [0.1, 8], releaseModel: "hybrid", territories: ["North America"], submissionType: "Open to unsolicited", contactPathway: "Submissions portal or festival", preferredMaterials: ["screenplay", "screener"], exampleFilms: ["Boyhood", "The Babadook"], channels: ["Theatrical", "VOD"], website: "https://www.ifcfilms.com" },
  { id: "magnolia", name: "Magnolia Pictures", category: "boutique", description: "Boutique distributor known for documentaries and independent narrative films.", genres: ["Documentary", "Drama", "Foreign Language"], budgetRange: [0.1, 5], releaseModel: "hybrid", territories: ["North America"], submissionType: "Open to unsolicited", contactPathway: "Email submissions accepted", preferredMaterials: ["screener", "press-kit"], exampleFilms: ["Blackfish", "The Square"], channels: ["Theatrical", "VOD"], website: "https://www.magpictures.com" },
  { id: "filmrise", name: "FilmRise", category: "aggregator", description: "Digital-first content aggregator distributing across AVOD and FAST platforms.", genres: ["All genres"], budgetRange: [0.05, 5], releaseModel: "streaming", territories: ["North America"], submissionType: "Open to unsolicited", contactPathway: "Online submission form", preferredMaterials: ["screener"], exampleFilms: ["Wide catalog of indie titles"], channels: ["AVOD", "FAST"], website: "https://www.filmrise.com" },
  // Major
  { id: "universal", name: "Universal Pictures", category: "major", description: "Major studio with broad genre portfolio from blockbusters to prestige.", genres: ["All genres"], budgetRange: [15, 250], releaseModel: "theatrical", territories: ["Global"], submissionType: "Agent submission", contactPathway: "Top-tier agency representation required", preferredMaterials: ["screenplay", "pitch-deck", "sizzle-reel"], exampleFilms: ["Oppenheimer", "Jurassic World", "Get Out"], channels: ["Theatrical", "Peacock"], website: "https://www.universalpictures.com" },
  // Sales Agents
  { id: "protagonist", name: "Protagonist Pictures", category: "sales_agent", description: "International sales agent and financier for quality-driven independent films.", genres: ["Drama", "Thriller", "Art House"], budgetRange: [0.5, 20], releaseModel: "theatrical", territories: ["International"], submissionType: "Producer submission", contactPathway: "Via producer or market meeting", preferredMaterials: ["screenplay", "pitch-deck", "financial-plan"], exampleFilms: ["The Lobster", "A Ghost Story"], channels: ["Theatrical", "VOD"], website: "https://protagonistpictures.com" },
  { id: "endeavor", name: "Endeavor Content", category: "sales_agent", description: "Major talent agency's content arm handling worldwide sales for premium projects.", genres: ["Drama", "Thriller", "Action", "Comedy"], budgetRange: [2, 80], releaseModel: "theatrical", territories: ["Global"], submissionType: "Agent submission", contactPathway: "WME/Endeavor representation", preferredMaterials: ["screenplay", "pitch-deck", "financial-plan"], exampleFilms: ["Knives Out", "La La Land"], channels: ["Theatrical", "Streaming"], website: "https://www.endeavorcontent.com" },
  // Aggregator
  { id: "gravitas", name: "Gravitas Ventures", category: "aggregator", description: "Digital distributor placing indie content across 100+ streaming platforms.", genres: ["All genres"], budgetRange: [0.01, 3], releaseModel: "streaming", territories: ["North America", "International"], submissionType: "Open to unsolicited", contactPathway: "Online submission portal", preferredMaterials: ["screener", "metadata-sheet"], exampleFilms: ["Wide indie catalog"], channels: ["VOD", "AVOD", "FAST"], website: "https://www.gravitasventures.com" },
];

export default function DistributorExplorer() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<DistributorCategory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return DISTRIBUTORS.filter(d => {
      if (activeCategory && d.category !== activeCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        return d.name.toLowerCase().includes(q) || d.genres.some(g => g.toLowerCase().includes(q)) || d.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, activeCategory]);

  const selected = selectedId ? DISTRIBUTORS.find(d => d.id === selectedId) : null;
  const categories = Object.keys(CATEGORY_LABELS) as DistributorCategory[];

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search distributors, genres..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all border ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              }`}>
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((dist, i) => (
          <motion.div key={dist.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => setSelectedId(dist.id)}
            className="border border-border rounded-lg p-4 cursor-pointer hover:border-primary/30 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-sm">{dist.name}</h4>
              <Badge variant="outline" className="text-[9px] shrink-0">{CATEGORY_LABELS[dist.category]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{dist.description}</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {dist.genres.slice(0, 3).map(g => (
                <span key={g} className="text-[9px] px-1.5 py-0.5 bg-secondary rounded-full text-secondary-foreground">{g}</span>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>${dist.budgetRange[0]}M–${dist.budgetRange[1]}M</span>
              <span>•</span>
              <span className="capitalize">{dist.releaseModel}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
            onClick={() => setSelectedId(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="border border-border bg-card rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">{selected.name}</h2>
                  <Badge variant="outline" className="text-xs mt-1">{CATEGORY_LABELS[selected.category]}</Badge>
                </div>
                <button onClick={() => setSelectedId(null)} className="p-1 rounded-lg hover:bg-secondary transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-4">{selected.description}</p>

              <div className="space-y-4">
                <div className="bg-secondary/50 rounded-lg p-3">
                  <h4 className="text-xs text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5"><Film className="h-3 w-3" /> Notable Releases</h4>
                  <p className="text-sm">{selected.exampleFilms.join(", ")}</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-3">
                  <h4 className="text-xs text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Territories</h4>
                  <p className="text-sm">{selected.territories.join(", ")}</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-3">
                  <h4 className="text-xs text-primary uppercase tracking-wider mb-2">Submission Path</h4>
                  <p className="text-sm">{selected.submissionType}</p>
                  <p className="text-xs text-muted-foreground mt-1">{selected.contactPathway}</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-3">
                  <h4 className="text-xs text-primary uppercase tracking-wider mb-2">Required Materials</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.preferredMaterials.map(m => (
                      <span key={m} className="text-[10px] px-2 py-0.5 bg-secondary rounded-full capitalize">{m.replace(/-/g, " ")}</span>
                    ))}
                  </div>
                </div>
                <a href={selected.website} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <Globe className="h-3 w-3" /> Visit Website <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
