// Provinces, territories and states, each with its main cities, for choosing
// where to search. Places are written "City, XX" ("London, ON") everywhere
// in the app. The server expands them ("London, Ontario, Canada") and tells
// the map lookup which country to stay in, so London, ON never lands in
// England. Shared by the browser and the server.

export type CountryCode = "CA" | "US";

export interface Region {
  code: string;
  name: string;
  country: CountryCode;
  /** Main cities, biggest first. The first one is the default pick. */
  cities: string[];
}

export const COUNTRY_NAMES: Record<CountryCode, string> = { CA: "Canada", US: "United States" };

const ca = (code: string, name: string, cities: string[]): Region => ({ code, name, country: "CA", cities });
const us = (code: string, name: string, cities: string[]): Region => ({ code, name, country: "US", cities });

export const REGIONS: Region[] = [
  ca("AB", "Alberta", ["Calgary", "Edmonton", "Red Deer", "Lethbridge", "St. Albert", "Airdrie", "Medicine Hat", "Grande Prairie", "Spruce Grove", "Sherwood Park", "Leduc", "Fort McMurray", "Okotoks", "Cochrane", "Fort Saskatchewan", "Chestermere", "Lloydminster", "Camrose", "Canmore", "Brooks"]),
  ca("BC", "British Columbia", ["Vancouver", "Surrey", "Burnaby", "Richmond", "Abbotsford", "Coquitlam", "Kelowna", "Langley", "Saanich", "Delta", "Nanaimo", "Kamloops", "Victoria", "Chilliwack", "Maple Ridge", "Prince George", "New Westminster", "North Vancouver", "Port Coquitlam", "West Vancouver", "Vernon", "Penticton", "Mission", "Courtenay", "Campbell River", "Squamish", "Cranbrook", "Fort St. John", "Whistler"]),
  ca("MB", "Manitoba", ["Winnipeg", "Brandon", "Steinbach", "Winkler", "Portage la Prairie", "Thompson", "Selkirk", "Morden", "Dauphin", "The Pas"]),
  ca("NB", "New Brunswick", ["Moncton", "Saint John", "Fredericton", "Dieppe", "Riverview", "Quispamsis", "Miramichi", "Edmundston", "Bathurst", "Rothesay", "Campbellton"]),
  ca("NL", "Newfoundland and Labrador", ["St. John's", "Conception Bay South", "Mount Pearl", "Paradise", "Corner Brook", "Grand Falls-Windsor", "Gander", "Happy Valley-Goose Bay", "Labrador City", "Torbay"]),
  ca("NT", "Northwest Territories", ["Yellowknife", "Hay River", "Inuvik", "Fort Smith"]),
  ca("NS", "Nova Scotia", ["Halifax", "Dartmouth", "Sydney", "Truro", "New Glasgow", "Bedford", "Kentville", "Bridgewater", "Antigonish", "Wolfville", "Yarmouth", "Amherst"]),
  ca("NU", "Nunavut", ["Iqaluit", "Rankin Inlet", "Arviat", "Cambridge Bay", "Baker Lake"]),
  ca("ON", "Ontario", ["Toronto", "Ottawa", "Mississauga", "Brampton", "Hamilton", "London", "Markham", "Vaughan", "Kitchener", "Windsor", "Richmond Hill", "Oakville", "Burlington", "Oshawa", "Sudbury", "Barrie", "St. Catharines", "Cambridge", "Kingston", "Guelph", "Whitby", "Ajax", "Milton", "Thunder Bay", "Waterloo", "Pickering", "Niagara Falls", "Newmarket", "Peterborough", "Brantford", "Sault Ste. Marie", "Sarnia", "Belleville", "Welland", "North Bay", "Cornwall", "Timmins", "Orillia", "Stratford", "Woodstock", "Aurora", "Collingwood", "Owen Sound"]),
  ca("PE", "Prince Edward Island", ["Charlottetown", "Summerside", "Stratford", "Cornwall", "Montague", "Souris"]),
  ca("QC", "Quebec", ["Montréal", "Québec City", "Laval", "Gatineau", "Longueuil", "Sherbrooke", "Saguenay", "Lévis", "Trois-Rivières", "Terrebonne", "Saint-Jean-sur-Richelieu", "Repentigny", "Brossard", "Drummondville", "Saint-Jérôme", "Granby", "Blainville", "Mirabel", "Mascouche", "Châteauguay", "Saint-Hyacinthe", "Rimouski", "Shawinigan", "Victoriaville", "Joliette", "Rouyn-Noranda", "Val-d'Or", "Sept-Îles"]),
  ca("SK", "Saskatchewan", ["Saskatoon", "Regina", "Prince Albert", "Moose Jaw", "Swift Current", "Yorkton", "North Battleford", "Estevan", "Warman", "Weyburn", "Martensville"]),
  ca("YT", "Yukon", ["Whitehorse", "Dawson City", "Watson Lake", "Haines Junction"]),

  us("AL", "Alabama", ["Birmingham", "Huntsville", "Montgomery", "Mobile", "Tuscaloosa", "Hoover"]),
  us("AK", "Alaska", ["Anchorage", "Fairbanks", "Juneau", "Wasilla"]),
  us("AZ", "Arizona", ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Gilbert", "Glendale", "Tempe", "Peoria", "Flagstaff"]),
  us("AR", "Arkansas", ["Little Rock", "Fayetteville", "Fort Smith", "Springdale", "Jonesboro", "Rogers", "Bentonville"]),
  us("CA", "California", ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Long Beach", "Oakland", "Bakersfield", "Anaheim", "Santa Ana", "Riverside", "Irvine", "Stockton", "Santa Barbara"]),
  us("CO", "Colorado", ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Boulder", "Pueblo"]),
  us("CT", "Connecticut", ["Bridgeport", "Stamford", "New Haven", "Hartford", "Waterbury", "Norwalk"]),
  us("DE", "Delaware", ["Wilmington", "Dover", "Newark"]),
  us("DC", "District of Columbia", ["Washington"]),
  us("FL", "Florida", ["Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Fort Lauderdale", "Tallahassee", "Cape Coral", "Port St. Lucie", "Hialeah", "West Palm Beach", "Sarasota", "Fort Myers", "Naples", "Gainesville"]),
  us("GA", "Georgia", ["Atlanta", "Columbus", "Augusta", "Macon", "Savannah", "Athens", "Alpharetta"]),
  us("HI", "Hawaii", ["Honolulu", "Hilo", "Kailua", "Kahului"]),
  us("ID", "Idaho", ["Boise", "Meridian", "Nampa", "Idaho Falls", "Coeur d'Alene", "Pocatello"]),
  us("IL", "Illinois", ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Peoria"]),
  us("IN", "Indiana", ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel", "Fishers", "Bloomington"]),
  us("IA", "Iowa", ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City"]),
  us("KS", "Kansas", ["Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka", "Lawrence"]),
  us("KY", "Kentucky", ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington"]),
  us("LA", "Louisiana", ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles"]),
  us("ME", "Maine", ["Portland", "Lewiston", "Bangor", "South Portland"]),
  us("MD", "Maryland", ["Baltimore", "Columbia", "Germantown", "Silver Spring", "Frederick", "Rockville", "Annapolis"]),
  us("MA", "Massachusetts", ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Brockton", "Quincy"]),
  us("MI", "Michigan", ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing", "Troy", "Kalamazoo"]),
  us("MN", "Minnesota", ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington", "Brooklyn Park"]),
  us("MS", "Mississippi", ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi"]),
  us("MO", "Missouri", ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence"]),
  us("MT", "Montana", ["Billings", "Missoula", "Great Falls", "Bozeman", "Helena"]),
  us("NE", "Nebraska", ["Omaha", "Lincoln", "Bellevue", "Grand Island"]),
  us("NV", "Nevada", ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks"]),
  us("NH", "New Hampshire", ["Manchester", "Nashua", "Concord", "Portsmouth"]),
  us("NJ", "New Jersey", ["Newark", "Jersey City", "Paterson", "Elizabeth", "Edison", "Toms River", "Trenton"]),
  us("NM", "New Mexico", ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe"]),
  us("NY", "New York", ["New York", "Brooklyn", "Queens", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany"]),
  us("NC", "North Carolina", ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Wilmington", "Asheville"]),
  us("ND", "North Dakota", ["Fargo", "Bismarck", "Grand Forks", "Minot"]),
  us("OH", "Ohio", ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton"]),
  us("OK", "Oklahoma", ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond"]),
  us("OR", "Oregon", ["Portland", "Eugene", "Salem", "Gresham", "Hillsboro", "Beaverton", "Bend", "Medford"]),
  us("PA", "Pennsylvania", ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton", "Lancaster", "Harrisburg"]),
  us("RI", "Rhode Island", ["Providence", "Warwick", "Cranston", "Pawtucket", "Newport"]),
  us("SC", "South Carolina", ["Charleston", "Columbia", "North Charleston", "Mount Pleasant", "Rock Hill", "Greenville", "Myrtle Beach"]),
  us("SD", "South Dakota", ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings"]),
  us("TN", "Tennessee", ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin"]),
  us("TX", "Texas", ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso", "Arlington", "Corpus Christi", "Plano", "Lubbock", "Laredo", "Irving", "Frisco", "McKinney"]),
  us("UT", "Utah", ["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem", "Sandy", "Ogden", "St. George"]),
  us("VT", "Vermont", ["Burlington", "South Burlington", "Rutland", "Montpelier"]),
  us("VA", "Virginia", ["Virginia Beach", "Chesapeake", "Norfolk", "Arlington", "Richmond", "Newport News", "Alexandria"]),
  us("WA", "Washington", ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Kent", "Everett"]),
  us("WV", "West Virginia", ["Charleston", "Huntington", "Morgantown", "Parkersburg"]),
  us("WI", "Wisconsin", ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine", "Appleton"]),
  us("WY", "Wyoming", ["Cheyenne", "Casper", "Laramie", "Gillette"]),
];

/** Lowercase, accents and dots removed, so "Québec", "quebec" and "Que." match. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const ALIASES: Record<string, string> = {
  pei: "PE",
  newfoundland: "NL",
  labrador: "NL",
  nfld: "NL",
  "yukon territory": "YT",
  que: "QC",
  "washington dc": "DC",
  dc: "DC",
};

const BY_KEY = new Map<string, Region>();
for (const r of REGIONS) {
  BY_KEY.set(norm(r.code), r);
  BY_KEY.set(norm(r.name), r);
}
for (const [alias, code] of Object.entries(ALIASES)) BY_KEY.set(alias, REGIONS.find((r) => r.code === code)!);

const COUNTRY_WORDS: Record<string, CountryCode> = { canada: "CA", usa: "US", us: "US", "united states": "US", "united states of america": "US" };

export function regionByCode(code: string | undefined): Region | undefined {
  return code ? REGIONS.find((r) => r.code === code.toUpperCase()) : undefined;
}

/**
 * Read "Toronto, ON", "Toronto, Ontario, Canada" or "Austin, TX". Anything
 * else (one word, another country) comes back as plain text with no region.
 */
export function parsePlace(text: string): { city: string; region?: Region } {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  let country: CountryCode | undefined;
  if (parts.length >= 2 && COUNTRY_WORDS[norm(parts[parts.length - 1])]) country = COUNTRY_WORDS[norm(parts.pop()!)];
  if (parts.length >= 2) {
    const region = BY_KEY.get(norm(parts[parts.length - 1]));
    if (region && (!country || region.country === country)) return { city: parts.slice(0, -1).join(", "), region };
  }
  return { city: text.trim() };
}

/** "Toronto" + Ontario → "Toronto, ON". */
export function formatPlace(city: string, region?: Region): string {
  const c = city.trim();
  return region && c ? `${c}, ${region.code}` : c;
}

export interface ExpandedPlace {
  /** Free-text form for map lookups and Google: "London, Ontario, Canada". */
  query: string;
  /** Set when the place names a known province or state. */
  city?: string;
  state?: string;
  country?: string;
  /** Lowercase ISO code, to keep a map lookup inside the right country. */
  countryCode?: "ca" | "us";
}

export function expandPlace(text: string): ExpandedPlace {
  const { city, region } = parsePlace(text);
  if (!region) return { query: text.trim() };
  const country = COUNTRY_NAMES[region.country];
  return { query: `${city}, ${region.name}, ${country}`, city, state: region.name, country, countryCode: region.country === "CA" ? "ca" : "us" };
}

// "in Toronto, ON", "near Halifax, Nova Scotia", "around Montréal, QC": any
// known province or state, by code or name, longest names first.
const REGION_WORDS = [...new Set(REGIONS.flatMap((r) => [r.name, r.code]))]
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const CITY_IN_REGION = new RegExp(`\\b(?:in|near|around)\\s+(\\p{Lu}[\\p{L}.'’ -]*?),\\s*(${REGION_WORDS})\\b`, "u");

/** The place named in a sentence such as an agent's goal, as "City, XX" when it can tell. */
export function placeInText(text: string): string | undefined {
  const m = text.match(CITY_IN_REGION);
  if (m) {
    const p = parsePlace(`${m[1]}, ${m[2]}`);
    if (p.region) return formatPlace(p.city, p.region);
  }
  const one = text.match(/\b(?:in|near|around)\s+(\p{Lu}[\p{L}.'’ -]{2,30}?)(?:\s+(?:that|with|who|which)\b|[.!?]|$)/u);
  return one?.[1]?.trim();
}
