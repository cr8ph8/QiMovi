import { FountainElement } from "./fountain-parser";

const LINES_PER_PAGE = 52;

/**
 * Estimate how many "lines" an element occupies in standard screenplay format.
 * Dialogue and action wrap at different widths, but for pagination we use a
 * simple heuristic: 1 line per element, +1 for scene headings (top-margin).
 */
function lineWeight(el: FountainElement): number {
  if (el.type === "empty") return 1;
  if (el.type === "page_break") return 0; // explicit break handled separately
  if (el.type === "scene_heading") return 2; // heading + margin
  // Long action/dialogue lines wrap — estimate extra lines
  const extraWraps = Math.floor(el.text.length / 55);
  return 1 + extraWraps;
}

export interface PaginatedResult {
  pages: FountainElement[][];
  titlePage: {
    title?: string;
    credit?: string;
    author?: string;
    contact?: string;
    address?: string;
    phone?: string;
    email?: string;
  } | null;
}

/**
 * Split parsed Fountain elements into pages of ~LINES_PER_PAGE lines each.
 * - Respects explicit `page_break` elements.
 * - Never places a scene heading as the last element on a page.
 * - Detects title page metadata from the first few elements.
 */
export function paginateElements(elements: FountainElement[]): PaginatedResult {
  if (elements.length === 0) return { pages: [], titlePage: null };

  // Detect title page metadata from leading title_page-type elements or
  // action lines that match "Title:", "Credit:", "Author:" patterns
  let titlePage: PaginatedResult["titlePage"] = null;
  let startIdx = 0;

  // Scan the first few lines for title metadata
  const titleMeta: Record<string, string> = {};
  for (let i = 0; i < Math.min(10, elements.length); i++) {
    const el = elements[i];
    if (el.type === "title_page") {
      const match = el.text.match(/^(Title|Credit|Author|Contact|Address|Phone|Email):\s*(.+)/i);
      if (match) {
        titleMeta[match[1].toLowerCase()] = match[2].trim();
        startIdx = i + 1;
      }
    } else if (el.type === "action" && i < 6) {
      const match = el.text.match(/^(Title|Credit|Author|Contact|Address|Phone|Email):\s*(.+)/i);
      if (match) {
        titleMeta[match[1].toLowerCase()] = match[2].trim();
        startIdx = i + 1;
        continue;
      }
      break;
    } else if (el.type === "empty") {
      continue;
    } else {
      break;
    }
  }

  if (titleMeta.title) {
    titlePage = {
      title: titleMeta.title,
      credit: titleMeta.credit,
      author: titleMeta.author,
      contact: titleMeta.contact,
      address: titleMeta.address,
      phone: titleMeta.phone,
      email: titleMeta.email,
    };
  }

  // Skip leading empty lines after title metadata
  while (startIdx < elements.length && elements[startIdx].type === "empty") {
    startIdx++;
  }

  const pages: FountainElement[][] = [];
  let currentPage: FountainElement[] = [];
  let currentLines = 0;

  for (let i = startIdx; i < elements.length; i++) {
    const el = elements[i];

    // Explicit page break → flush current page
    if (el.type === "page_break") {
      if (currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentLines = 0;
      }
      continue;
    }

    const weight = lineWeight(el);

    // Would this element overflow the page?
    if (currentLines + weight > LINES_PER_PAGE && currentPage.length > 0) {
      // Don't leave a scene heading stranded at the bottom — pull it to next page
      if (
        currentPage.length > 0 &&
        currentPage[currentPage.length - 1].type === "scene_heading"
      ) {
        const heading = currentPage.pop()!;
        pages.push(currentPage);
        currentPage = [heading];
        currentLines = lineWeight(heading);
      } else {
        pages.push(currentPage);
        currentPage = [];
        currentLines = 0;
      }
    }

    currentPage.push(el);
    currentLines += weight;
  }

  // Flush remaining
  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return { pages, titlePage };
}
