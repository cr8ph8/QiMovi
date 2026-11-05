// Shared deterministic proxy for an ordinary AI-assisted recommender. The
// proposer sees candidate metadata and claimed endorsements only.
const words = value => new Set(value.toLowerCase().match(/[a-z]+/g) ?? []);

export function rankDiscovery(records, query) {
  return records.flatMap(record => {
    const title = words(record.title);
    const description = words(record.description);
    const tags = words(record.tags.join(' '));
    const matchedTerms = query.terms.filter(term => title.has(term) || description.has(term) || tags.has(term));
    if (query.terms.length && matchedTerms.length < 2) return [];
    const lexicalScore = matchedTerms.reduce((sum, term) => sum
      + 4 * Number(title.has(term)) + 2 * Number(tags.has(term)) + Number(description.has(term)), 0);
    const endorsements = new Set(record.evidence.map(item => item.author)).size;
    return [{ videoId: record.id, score: lexicalScore + 3 * endorsements, matchedTerms, endorsements }];
  }).sort((a, b) => b.score - a.score || (a.videoId < b.videoId ? -1 : 1));
}
