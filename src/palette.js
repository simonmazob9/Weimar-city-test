// Quiet, warm colours for the building uses. None of them is blue, so the blue reach shades stand out.
// `undefined` also covers the one building that has no use at all.
export const USES = [
  { use: 'residential', label: 'Residential', color: '#e6ddcc' },
  { use: 'service', label: 'Service', color: '#c2b195' },
  { use: 'office', label: 'Office', color: '#a8a38f' },
  { use: 'retail', label: 'Retail', color: '#dbb46e' },
  { use: 'food_and_drink', label: 'Food and drink', color: '#d0946f' },
  { use: 'accommodation', label: 'Accommodation', color: '#b98668' },
  { use: 'entertainment', label: 'Entertainment', color: '#c79cb6' },
  { use: 'culture', label: 'Culture', color: '#a68aae' },
  { use: 'education', label: 'Education', color: '#adc08c' },
  { use: 'sport', label: 'Sport', color: '#88a877' },
  { use: 'health', label: 'Health', color: '#d9a1a1' },
  { use: 'civic', label: 'Civic', color: '#b7948e' },
  { use: 'transport', label: 'Transport', color: '#93918a' },
  { use: 'light_industrial', label: 'Light industrial', color: '#776d61' },
  { use: 'undefined', label: 'Use not known', color: '#d3d1cc' },
]

export const USE_COLOR = Object.fromEntries(USES.map((u) => [u.use, u.color]))

// One accent colour, three shades: darkest for the closest area.
export const REACH_COLORS = ['#24527f', '#5a8ec4', '#a9c9ea']

// Places picked in "Explore": a strong magenta, far from the blue reach shades and the quiet use colours.
export const EXPLORE_COLOR = '#d81b7a'

// The walking route to a place: a bright orange, apart from the blues and the magenta.
export const ROUTE_COLOR = '#f26b00'

export const GROUND = '#f2f0ea'
export const STREET = '#8c8880'
