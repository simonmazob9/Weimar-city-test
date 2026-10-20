// The interests of "Explore". The buildings have no names and no amenity or tourism tags:
// the only fields that tell what a building is used for are `use` (the use with the largest floor area)
// and `floor_area_m2` (floor area per use). A building belongs to an interest if it has any floor area
// of one of the interest's uses, so a ground-floor café in a residential building counts too.

export const INTERESTS = [
  {
    key: 'art',
    label: 'Art and design',
    uses: ['culture'],
    empty: 'No art and design buildings in this data.',
    note: 'Buildings with floor area of the use "culture". The data can\'t tell a museum or gallery from a theatre or library, and it has no names.',
  },
  {
    key: 'history',
    label: 'History',
    uses: [],
    empty: 'No history buildings in this data.',
    note: 'Nothing in the data marks history museums, monuments, churches or historic buildings.',
  },
  {
    key: 'tourist',
    label: 'Tourist',
    // everything in the two interests above, plus visitor buildings
    uses: ['culture', 'entertainment', 'accommodation'],
    empty: 'No tourist buildings in this data.',
    note: 'Art and design and history, plus buildings with floor area of the use "entertainment" or "accommodation".',
  },
  {
    key: 'markets',
    label: 'Markets and food',
    uses: ['food_and_drink'],
    empty: 'No market or food buildings in this data.',
    note: 'Buildings with floor area of the use "food_and_drink". The data has no separate use for market halls, weekly markets, supermarkets or food shops: shops are all "retail", without telling food from clothes, so they are left out. Open marketplaces are squares, not buildings.',
  },
]

// Indices of the buildings that belong to an interest.
export function placesFor(interest, buildings) {
  const uses = new Set(interest.uses)
  return buildings.filter((b) => b.uses.some((u) => uses.has(u))).map((b) => b.index)
}
