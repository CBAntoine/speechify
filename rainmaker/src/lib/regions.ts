// Where to search, across North America: Canada's provinces and territories,
// the US states (plus Puerto Rico and the US Virgin Islands), Mexico's 32
// states, and every country of Central America and the Caribbean plus
// Bermuda, Greenland and Saint Pierre and Miquelon, each with its main
// cities. Shared by the browser and the server.
//
// Places are written:
//   "City, XX"       a Canadian province or US state or territory ("London, ON")
//   "City, XXX"      a Mexican state by its ISO code ("Monterrey, NLE")
//   "City, Country"  every other country ("Kingston, Jamaica")
// The server expands them ("London, Ontario, Canada") and keeps map lookups
// inside the right country, so London, ON never lands in England.

import { COUNTRIES, countryByCode, type Country, type CountryCode, type Lang } from "./markets.ts";

export type { CountryCode } from "./markets.ts";

export interface Region {
  code: string;
  name: string;
  country: CountryCode;
  /** Main cities, biggest first. The first one is the default pick. */
  cities: string[];
  /** Language most of its businesses use, when it differs from the country's first. */
  lang?: Lang;
  /** Nominatim country code, when the map files it apart from its country (Puerto Rico → "pr"). */
  osm?: string;
  /** IANA time zone most of its businesses use. */
  timezone?: string;
}

export const COUNTRY_NAMES = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name])) as Record<CountryCode, string>;

type Extra = Partial<Pick<Region, "lang" | "osm">>;
const ca = (code: string, name: string, timezone: string, cities: string[], extra: Extra = {}): Region => ({ code, name, country: "CA", cities, timezone, ...extra });
const us = (code: string, name: string, timezone: string, cities: string[], extra: Extra = {}): Region => ({ code, name, country: "US", cities, timezone, ...extra });
const mx = (code: string, name: string, timezone: string, cities: string[]): Region => ({ code, name, country: "MX", cities, timezone });
/** A country without provinces or states here: it is its own region. */
const one = (code: CountryCode, cities: string[]): Region => ({ code, name: countryByCode(code)!.name, country: code, cities });

const CT = "America/Chicago";
const ET = "America/New_York";
const MT = "America/Denver";
const PT = "America/Los_Angeles";
const CDMX = "America/Mexico_City";

export const REGIONS: Region[] = [
  ca("AB", "Alberta", "America/Edmonton", ["Calgary", "Edmonton", "Red Deer", "Lethbridge", "St. Albert", "Airdrie", "Medicine Hat", "Grande Prairie", "Spruce Grove", "Sherwood Park", "Leduc", "Fort McMurray", "Okotoks", "Cochrane", "Fort Saskatchewan", "Chestermere", "Lloydminster", "Camrose", "Canmore", "Brooks"]),
  ca("BC", "British Columbia", "America/Vancouver", ["Vancouver", "Surrey", "Burnaby", "Richmond", "Abbotsford", "Coquitlam", "Kelowna", "Langley", "Saanich", "Delta", "Nanaimo", "Kamloops", "Victoria", "Chilliwack", "Maple Ridge", "Prince George", "New Westminster", "North Vancouver", "Port Coquitlam", "West Vancouver", "Vernon", "Penticton", "Mission", "Courtenay", "Campbell River", "Squamish", "Cranbrook", "Fort St. John", "Whistler"]),
  ca("MB", "Manitoba", "America/Winnipeg", ["Winnipeg", "Brandon", "Steinbach", "Winkler", "Portage la Prairie", "Thompson", "Selkirk", "Morden", "Dauphin", "The Pas"]),
  ca("NB", "New Brunswick", "America/Moncton", ["Moncton", "Saint John", "Fredericton", "Dieppe", "Riverview", "Quispamsis", "Miramichi", "Edmundston", "Bathurst", "Rothesay", "Campbellton"]),
  ca("NL", "Newfoundland and Labrador", "America/St_Johns", ["St. John's", "Conception Bay South", "Mount Pearl", "Paradise", "Corner Brook", "Grand Falls-Windsor", "Gander", "Happy Valley-Goose Bay", "Labrador City", "Torbay"]),
  ca("NT", "Northwest Territories", "America/Yellowknife", ["Yellowknife", "Hay River", "Inuvik", "Fort Smith"]),
  ca("NS", "Nova Scotia", "America/Halifax", ["Halifax", "Dartmouth", "Sydney", "Truro", "New Glasgow", "Bedford", "Kentville", "Bridgewater", "Antigonish", "Wolfville", "Yarmouth", "Amherst"]),
  ca("NU", "Nunavut", "America/Iqaluit", ["Iqaluit", "Rankin Inlet", "Arviat", "Cambridge Bay", "Baker Lake"]),
  ca("ON", "Ontario", "America/Toronto", ["Toronto", "Ottawa", "Mississauga", "Brampton", "Hamilton", "London", "Markham", "Vaughan", "Kitchener", "Windsor", "Richmond Hill", "Oakville", "Burlington", "Oshawa", "Sudbury", "Barrie", "St. Catharines", "Cambridge", "Kingston", "Guelph", "Whitby", "Ajax", "Milton", "Thunder Bay", "Waterloo", "Pickering", "Niagara Falls", "Newmarket", "Peterborough", "Brantford", "Sault Ste. Marie", "Sarnia", "Belleville", "Welland", "North Bay", "Cornwall", "Timmins", "Orillia", "Stratford", "Woodstock", "Aurora", "Collingwood", "Owen Sound"]),
  ca("PE", "Prince Edward Island", "America/Halifax", ["Charlottetown", "Summerside", "Stratford", "Cornwall", "Montague", "Souris"]),
  ca("QC", "Quebec", "America/Toronto", ["Montréal", "Québec City", "Laval", "Gatineau", "Longueuil", "Sherbrooke", "Saguenay", "Lévis", "Trois-Rivières", "Terrebonne", "Saint-Jean-sur-Richelieu", "Repentigny", "Brossard", "Drummondville", "Saint-Jérôme", "Granby", "Blainville", "Mirabel", "Mascouche", "Châteauguay", "Saint-Hyacinthe", "Rimouski", "Shawinigan", "Victoriaville", "Joliette", "Rouyn-Noranda", "Val-d'Or", "Sept-Îles"], { lang: "fr" }),
  ca("SK", "Saskatchewan", "America/Regina", ["Saskatoon", "Regina", "Prince Albert", "Moose Jaw", "Swift Current", "Yorkton", "North Battleford", "Estevan", "Warman", "Weyburn", "Martensville"]),
  ca("YT", "Yukon", "America/Whitehorse", ["Whitehorse", "Dawson City", "Watson Lake", "Haines Junction"]),

  us("AL", "Alabama", CT, ["Birmingham", "Huntsville", "Montgomery", "Mobile", "Tuscaloosa", "Hoover"]),
  us("AK", "Alaska", "America/Anchorage", ["Anchorage", "Fairbanks", "Juneau", "Wasilla"]),
  us("AZ", "Arizona", "America/Phoenix", ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Gilbert", "Glendale", "Tempe", "Peoria", "Flagstaff"]),
  us("AR", "Arkansas", CT, ["Little Rock", "Fayetteville", "Fort Smith", "Springdale", "Jonesboro", "Rogers", "Bentonville"]),
  us("CA", "California", PT, ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Long Beach", "Oakland", "Bakersfield", "Anaheim", "Santa Ana", "Riverside", "Irvine", "Stockton", "Santa Barbara"]),
  us("CO", "Colorado", MT, ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Boulder", "Pueblo"]),
  us("CT", "Connecticut", ET, ["Bridgeport", "Stamford", "New Haven", "Hartford", "Waterbury", "Norwalk"]),
  us("DE", "Delaware", ET, ["Wilmington", "Dover", "Newark"]),
  us("DC", "District of Columbia", ET, ["Washington"]),
  us("FL", "Florida", ET, ["Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Fort Lauderdale", "Tallahassee", "Cape Coral", "Port St. Lucie", "Hialeah", "West Palm Beach", "Sarasota", "Fort Myers", "Naples", "Gainesville"]),
  us("GA", "Georgia", ET, ["Atlanta", "Columbus", "Augusta", "Macon", "Savannah", "Athens", "Alpharetta"]),
  us("HI", "Hawaii", "Pacific/Honolulu", ["Honolulu", "Hilo", "Kailua", "Kahului"]),
  us("ID", "Idaho", "America/Boise", ["Boise", "Meridian", "Nampa", "Idaho Falls", "Coeur d'Alene", "Pocatello"]),
  us("IL", "Illinois", CT, ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Peoria"]),
  us("IN", "Indiana", "America/Indiana/Indianapolis", ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel", "Fishers", "Bloomington"]),
  us("IA", "Iowa", CT, ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City"]),
  us("KS", "Kansas", CT, ["Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka", "Lawrence"]),
  us("KY", "Kentucky", "America/Kentucky/Louisville", ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington"]),
  us("LA", "Louisiana", CT, ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles"]),
  us("ME", "Maine", ET, ["Portland", "Lewiston", "Bangor", "South Portland"]),
  us("MD", "Maryland", ET, ["Baltimore", "Columbia", "Germantown", "Silver Spring", "Frederick", "Rockville", "Annapolis"]),
  us("MA", "Massachusetts", ET, ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Brockton", "Quincy"]),
  us("MI", "Michigan", "America/Detroit", ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing", "Troy", "Kalamazoo"]),
  us("MN", "Minnesota", CT, ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington", "Brooklyn Park"]),
  us("MS", "Mississippi", CT, ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi"]),
  us("MO", "Missouri", CT, ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence"]),
  us("MT", "Montana", MT, ["Billings", "Missoula", "Great Falls", "Bozeman", "Helena"]),
  us("NE", "Nebraska", CT, ["Omaha", "Lincoln", "Bellevue", "Grand Island"]),
  us("NV", "Nevada", PT, ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks"]),
  us("NH", "New Hampshire", ET, ["Manchester", "Nashua", "Concord", "Portsmouth"]),
  us("NJ", "New Jersey", ET, ["Newark", "Jersey City", "Paterson", "Elizabeth", "Edison", "Toms River", "Trenton"]),
  us("NM", "New Mexico", MT, ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe"]),
  us("NY", "New York", ET, ["New York", "Brooklyn", "Queens", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany"]),
  us("NC", "North Carolina", ET, ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Wilmington", "Asheville"]),
  us("ND", "North Dakota", CT, ["Fargo", "Bismarck", "Grand Forks", "Minot"]),
  us("OH", "Ohio", ET, ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton"]),
  us("OK", "Oklahoma", CT, ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond"]),
  us("OR", "Oregon", PT, ["Portland", "Eugene", "Salem", "Gresham", "Hillsboro", "Beaverton", "Bend", "Medford"]),
  us("PA", "Pennsylvania", ET, ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton", "Lancaster", "Harrisburg"]),
  us("RI", "Rhode Island", ET, ["Providence", "Warwick", "Cranston", "Pawtucket", "Newport"]),
  us("SC", "South Carolina", ET, ["Charleston", "Columbia", "North Charleston", "Mount Pleasant", "Rock Hill", "Greenville", "Myrtle Beach"]),
  us("SD", "South Dakota", CT, ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings"]),
  us("TN", "Tennessee", CT, ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin"]),
  us("TX", "Texas", CT, ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso", "Arlington", "Corpus Christi", "Plano", "Lubbock", "Laredo", "Irving", "Frisco", "McKinney"]),
  us("UT", "Utah", MT, ["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem", "Sandy", "Ogden", "St. George"]),
  us("VT", "Vermont", ET, ["Burlington", "South Burlington", "Rutland", "Montpelier"]),
  us("VA", "Virginia", ET, ["Virginia Beach", "Chesapeake", "Norfolk", "Arlington", "Richmond", "Newport News", "Alexandria"]),
  us("WA", "Washington", PT, ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Kent", "Everett"]),
  us("WV", "West Virginia", ET, ["Charleston", "Huntington", "Morgantown", "Parkersburg"]),
  us("WI", "Wisconsin", CT, ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine", "Appleton"]),
  us("WY", "Wyoming", MT, ["Cheyenne", "Casper", "Laramie", "Gillette"]),
  us("PR", "Puerto Rico", "America/Puerto_Rico", ["San Juan", "Bayamón", "Carolina", "Ponce", "Caguas", "Guaynabo", "Arecibo", "Toa Baja", "Mayagüez", "Trujillo Alto", "Humacao", "Dorado", "Vega Baja", "Aguadilla", "Fajardo", "Cayey", "Manatí"], { lang: "es", osm: "pr" }),
  us("VI", "U.S. Virgin Islands", "America/St_Thomas", ["Charlotte Amalie", "Christiansted", "Frederiksted", "Cruz Bay"], { osm: "vi" }),

  mx("AGU", "Aguascalientes", CDMX, ["Aguascalientes", "Jesús María", "Calvillo", "Rincón de Romos", "Pabellón de Arteaga", "San Francisco de los Romo", "Asientos"]),
  mx("BCN", "Baja California", "America/Tijuana", ["Tijuana", "Mexicali", "Ensenada", "Playas de Rosarito", "Tecate", "San Quintín", "San Felipe"]),
  mx("BCS", "Baja California Sur", "America/Mazatlan", ["La Paz", "Cabo San Lucas", "San José del Cabo", "Ciudad Constitución", "Loreto", "Guerrero Negro", "Santa Rosalía", "Todos Santos"]),
  mx("CAM", "Campeche", "America/Merida", ["Campeche", "Ciudad del Carmen", "Champotón", "Escárcega", "Calkiní", "Hopelchén"]),
  mx("CHP", "Chiapas", CDMX, ["Tuxtla Gutiérrez", "Tapachula", "San Cristóbal de las Casas", "Comitán de Domínguez", "Chiapa de Corzo", "Palenque", "Villaflores", "Tonalá", "Ocosingo"]),
  mx("CHH", "Chihuahua", "America/Chihuahua", ["Ciudad Juárez", "Chihuahua", "Delicias", "Cuauhtémoc", "Hidalgo del Parral", "Nuevo Casas Grandes", "Camargo", "Jiménez"]),
  mx("CMX", "Ciudad de México", CDMX, ["Ciudad de México", "Iztapalapa", "Gustavo A. Madero", "Álvaro Obregón", "Tlalpan", "Coyoacán", "Cuauhtémoc", "Venustiano Carranza", "Benito Juárez", "Azcapotzalco", "Iztacalco", "Miguel Hidalgo", "Xochimilco", "Tláhuac", "Magdalena Contreras", "Cuajimalpa", "Milpa Alta"]),
  mx("COA", "Coahuila", "America/Monterrey", ["Saltillo", "Torreón", "Monclova", "Piedras Negras", "Ciudad Acuña", "Ramos Arizpe", "Matamoros", "Sabinas", "San Pedro", "Frontera", "Parras de la Fuente"]),
  mx("COL", "Colima", CDMX, ["Colima", "Manzanillo", "Villa de Álvarez", "Tecomán", "Armería", "Comala"]),
  mx("DUR", "Durango", "America/Monterrey", ["Durango", "Gómez Palacio", "Lerdo", "Santiago Papasquiaro", "Pueblo Nuevo", "Canatlán"]),
  mx("GUA", "Guanajuato", CDMX, ["León", "Irapuato", "Celaya", "Salamanca", "Guanajuato", "Silao", "San Miguel de Allende", "Pénjamo", "Valle de Santiago", "Dolores Hidalgo", "San Francisco del Rincón", "Acámbaro", "Salvatierra"]),
  mx("GRO", "Guerrero", CDMX, ["Acapulco", "Chilpancingo", "Iguala", "Zihuatanejo", "Taxco", "Tlapa de Comonfort", "Chilapa", "Coyuca de Benítez"]),
  mx("HID", "Hidalgo", CDMX, ["Pachuca", "Tulancingo", "Mineral de la Reforma", "Tizayuca", "Tula de Allende", "Huejutla de Reyes", "Ixmiquilpan", "Tepeji del Río", "Apan"]),
  mx("JAL", "Jalisco", CDMX, ["Guadalajara", "Zapopan", "Tlaquepaque", "Tlajomulco de Zúñiga", "Tonalá", "Puerto Vallarta", "El Salto", "Lagos de Moreno", "Tepatitlán", "Ciudad Guzmán", "Ocotlán", "Chapala", "Autlán"]),
  mx("MEX", "Estado de México", CDMX, ["Ecatepec", "Nezahualcóyotl", "Toluca", "Naucalpan", "Chimalhuacán", "Tlalnepantla", "Cuautitlán Izcalli", "Tecámac", "Ixtapaluca", "Atizapán de Zaragoza", "Tultitlán", "Nicolás Romero", "Valle de Chalco", "Chalco", "Huixquilucan", "Texcoco", "Coacalco", "Metepec", "Zinacantepec"]),
  mx("MIC", "Michoacán", CDMX, ["Morelia", "Uruapan", "Zamora", "Lázaro Cárdenas", "Apatzingán", "Zitácuaro", "La Piedad", "Pátzcuaro", "Sahuayo"]),
  mx("MOR", "Morelos", CDMX, ["Cuernavaca", "Jiutepec", "Cuautla", "Temixco", "Yautepec", "Emiliano Zapata", "Xochitepec", "Jojutla"]),
  mx("NAY", "Nayarit", "America/Mazatlan", ["Tepic", "Nuevo Vallarta", "Bucerías", "Santiago Ixcuintla", "Compostela", "Tuxpan", "Ixtlán del Río", "Sayulita", "San Blas"]),
  mx("NLE", "Nuevo León", "America/Monterrey", ["Monterrey", "Guadalupe", "Apodaca", "San Nicolás de los Garza", "General Escobedo", "Juárez", "Santa Catarina", "García", "San Pedro Garza García", "Cadereyta Jiménez", "Pesquería", "Salinas Victoria", "Linares", "Montemorelos", "Santiago"]),
  mx("OAX", "Oaxaca", CDMX, ["Oaxaca de Juárez", "Juchitán de Zaragoza", "Salina Cruz", "San Juan Bautista Tuxtepec", "Santa Cruz Xoxocotlán", "Puerto Escondido", "Huatulco", "Huajuapan de León", "Santa Lucía del Camino", "Tlaxiaco"]),
  mx("PUE", "Puebla", CDMX, ["Puebla", "Tehuacán", "San Martín Texmelucan", "San Andrés Cholula", "Atlixco", "San Pedro Cholula", "Teziutlán", "Huauchinango", "Amozoc", "Izúcar de Matamoros"]),
  mx("QUE", "Querétaro", CDMX, ["Querétaro", "San Juan del Río", "El Marqués", "Corregidora", "Tequisquiapan", "Pedro Escobedo", "Amealco", "Cadereyta de Montes"]),
  mx("ROO", "Quintana Roo", "America/Cancun", ["Cancún", "Playa del Carmen", "Chetumal", "Cozumel", "Tulum", "Puerto Morelos", "Felipe Carrillo Puerto", "Bacalar", "Isla Mujeres", "José María Morelos"]),
  mx("SLP", "San Luis Potosí", CDMX, ["San Luis Potosí", "Soledad de Graciano Sánchez", "Ciudad Valles", "Matehuala", "Rioverde", "Tamazunchale", "Ciudad Fernández"]),
  mx("SIN", "Sinaloa", "America/Mazatlan", ["Culiacán", "Mazatlán", "Los Mochis", "Guasave", "Navolato", "Guamúchil", "Escuinapa", "El Rosario"]),
  mx("SON", "Sonora", "America/Hermosillo", ["Hermosillo", "Ciudad Obregón", "Nogales", "San Luis Río Colorado", "Navojoa", "Guaymas", "Agua Prieta", "Caborca", "Puerto Peñasco", "Empalme", "Cananea"]),
  mx("TAB", "Tabasco", CDMX, ["Villahermosa", "Cárdenas", "Comalcalco", "Huimanguillo", "Macuspana", "Cunduacán", "Paraíso", "Tenosique"]),
  mx("TAM", "Tamaulipas", "America/Matamoros", ["Reynosa", "Matamoros", "Nuevo Laredo", "Ciudad Victoria", "Tampico", "Altamira", "Ciudad Madero", "Ciudad Mante", "Río Bravo", "Valle Hermoso"]),
  mx("TLA", "Tlaxcala", CDMX, ["Tlaxcala", "Apizaco", "Huamantla", "Chiautempan", "Calpulalpan", "Zacatelco", "Tlaxco"]),
  mx("VER", "Veracruz", CDMX, ["Veracruz", "Xalapa", "Coatzacoalcos", "Córdoba", "Poza Rica", "Boca del Río", "Minatitlán", "Orizaba", "Tuxpan", "Papantla", "Martínez de la Torre", "San Andrés Tuxtla", "Cosoleacaque", "Tierra Blanca"]),
  mx("YUC", "Yucatán", "America/Merida", ["Mérida", "Kanasín", "Valladolid", "Tizimín", "Progreso", "Umán", "Ticul", "Motul", "Izamal"]),
  mx("ZAC", "Zacatecas", CDMX, ["Zacatecas", "Fresnillo", "Guadalupe", "Jerez", "Río Grande", "Sombrerete", "Calera", "Loreto"]),

  one("BM", ["Hamilton", "St. George's", "Somerset Village", "Flatts Village", "Southampton", "Warwick", "Paget"]),
  one("GL", ["Nuuk", "Sisimiut", "Ilulissat", "Qaqortoq", "Aasiaat", "Maniitsoq", "Tasiilaq", "Uummannaq", "Narsaq", "Paamiut"]),
  one("PM", ["Saint-Pierre", "Miquelon", "Langlade"]),

  one("BZ", ["Belize City", "San Ignacio", "Belmopan", "Orange Walk Town", "San Pedro", "Corozal Town", "Dangriga", "Benque Viejo del Carmen", "Punta Gorda", "Placencia"]),
  one("CR", ["San José", "Alajuela", "Heredia", "Cartago", "Desamparados", "Liberia", "Escazú", "San Isidro de El General", "Puntarenas", "Limón", "Curridabat", "Santa Ana", "Tibás", "Grecia", "Ciudad Quesada", "Nicoya", "Jacó", "Tamarindo"]),
  one("SV", ["San Salvador", "Soyapango", "Santa Ana", "San Miguel", "Mejicanos", "Santa Tecla", "Apopa", "Ilopango", "Antiguo Cuscatlán", "Sonsonate", "Ahuachapán", "Usulután", "Zacatecoluca", "La Libertad", "Chalatenango"]),
  one("GT", ["Guatemala City", "Mixco", "Villa Nueva", "Quetzaltenango", "San Juan Sacatepéquez", "Escuintla", "San Miguel Petapa", "Chimaltenango", "Huehuetenango", "Cobán", "Antigua Guatemala", "Mazatenango", "Puerto Barrios", "Retalhuleu", "Chiquimula", "Jalapa", "Zacapa", "Flores"]),
  one("HN", ["Tegucigalpa", "San Pedro Sula", "Choloma", "La Ceiba", "El Progreso", "Villanueva", "Choluteca", "Comayagua", "Puerto Cortés", "Danlí", "Juticalpa", "Siguatepeque", "Tela", "Santa Rosa de Copán", "Roatán"]),
  one("NI", ["Managua", "León", "Masaya", "Matagalpa", "Chinandega", "Estelí", "Tipitapa", "Granada", "Ciudad Sandino", "Jinotega", "Juigalpa", "Bluefields", "Rivas", "Puerto Cabezas", "San Juan del Sur"]),
  one("PA", ["Panama City", "San Miguelito", "Arraiján", "La Chorrera", "Colón", "David", "Santiago de Veraguas", "Chitré", "Penonomé", "Aguadulce", "Las Tablas", "Boquete", "Bocas del Toro", "Coronado"]),

  one("AI", ["The Valley", "Sandy Ground", "Blowing Point", "Island Harbour", "West End", "South Hill"]),
  one("AG", ["St. John's", "All Saints", "Liberta", "English Harbour", "Jennings", "Codrington"]),
  one("AW", ["Oranjestad", "San Nicolaas", "Noord", "Santa Cruz", "Paradera", "Savaneta", "Palm Beach"]),
  one("BS", ["Nassau", "Freeport", "Marsh Harbour", "George Town", "West End", "Spanish Wells", "Alice Town"]),
  one("BB", ["Bridgetown", "Speightstown", "Oistins", "Holetown", "Warrens", "Bathsheba"]),
  one("VG", ["Road Town", "Spanish Town", "East End", "West End", "Great Harbour", "The Settlement"]),
  one("BQ", ["Kralendijk", "Rincon", "Antriol", "Oranjestad", "The Bottom", "Windwardside"]),
  one("KY", ["George Town", "West Bay", "Bodden Town", "East End", "North Side", "Savannah", "Cayman Brac"]),
  one("CU", ["Havana", "Santiago de Cuba", "Camagüey", "Holguín", "Santa Clara", "Guantánamo", "Bayamo", "Las Tunas", "Cienfuegos", "Pinar del Río", "Matanzas", "Ciego de Ávila", "Sancti Spíritus", "Manzanillo", "Cárdenas", "Varadero", "Trinidad"]),
  one("CW", ["Willemstad", "Barber", "Soto", "Sint Willibrordus", "Santa Rosa", "Tera Kora", "Westpunt"]),
  one("DM", ["Roseau", "Portsmouth", "Marigot", "Grand Bay", "Mahaut", "Castle Bruce"]),
  one("DO", ["Santo Domingo", "Santiago de los Caballeros", "Santo Domingo Este", "San Pedro de Macorís", "La Romana", "San Francisco de Macorís", "Higüey", "Punta Cana", "Bávaro", "Puerto Plata", "La Vega", "San Cristóbal", "Moca", "Baní", "Bonao", "Samaná"]),
  one("GD", ["St. George's", "Grenville", "Gouyave", "Victoria", "Sauteurs", "Hillsborough"]),
  one("GP", ["Pointe-à-Pitre", "Les Abymes", "Baie-Mahault", "Le Gosier", "Petit-Bourg", "Sainte-Anne", "Le Moule", "Basse-Terre", "Saint-François", "Sainte-Rose", "Capesterre-Belle-Eau", "Lamentin"]),
  one("HT", ["Port-au-Prince", "Carrefour", "Delmas", "Pétion-Ville", "Cap-Haïtien", "Gonaïves", "Saint-Marc", "Les Cayes", "Croix-des-Bouquets", "Jacmel", "Port-de-Paix", "Jérémie", "Hinche"]),
  one("JM", ["Kingston", "Portmore", "Spanish Town", "Montego Bay", "May Pen", "Mandeville", "Old Harbour", "Savanna-la-Mar", "Ocho Rios", "Linstead", "Port Antonio", "Negril", "Morant Bay"]),
  one("MQ", ["Fort-de-France", "Le Lamentin", "Le Robert", "Schœlcher", "Le François", "Sainte-Marie", "Ducos", "Saint-Joseph", "Le Marin", "Les Trois-Îlets", "Rivière-Pilote", "Saint-Pierre"]),
  one("MS", ["Brades", "Little Bay", "Salem", "St. Peter's", "Cudjoe Head", "Davy Hill", "Look Out"]),
  one("BL", ["Gustavia", "Saint-Jean", "Lorient", "Colombier", "Grand Cul-de-Sac", "Corossol"]),
  one("KN", ["Basseterre", "Charlestown", "Sandy Point Town", "Cayon", "Old Road Town", "Dieppe Bay Town"]),
  one("LC", ["Castries", "Gros Islet", "Vieux Fort", "Soufrière", "Micoud", "Dennery", "Rodney Bay"]),
  one("MF", ["Marigot", "Grand Case", "Quartier d'Orléans", "Sandy Ground", "Baie Nettlé", "Cul-de-Sac"]),
  one("VC", ["Kingstown", "Calliaqua", "Georgetown", "Barrouallie", "Layou", "Port Elizabeth", "Chateaubelair"]),
  one("SX", ["Philipsburg", "Simpson Bay", "Cole Bay", "Cul de Sac", "Lower Prince's Quarter", "Maho"]),
  one("TT", ["Port of Spain", "Chaguanas", "San Fernando", "Arima", "Couva", "Point Fortin", "Sangre Grande", "Diego Martin", "Tunapuna", "Princes Town", "Marabella", "Scarborough"]),
  one("TC", ["Providenciales", "Cockburn Town", "Grace Bay", "Cockburn Harbour", "Five Cays", "Bottle Creek"]),
];

/** Lowercase, no accents, dots or apostrophes, "&" as "and", "Saint" as "St", so "Québec", "quebec" and "Que." match. */
function key(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’()]/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bsainte\b/g, "ste")
    .replace(/\s+/g, " ")
    .trim();
}

/** Without accents, for matching text typed without them ("Nuevo Leon"). */
function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Countries with provinces or states in REGIONS (Canada, the US, Mexico). */
const WITH_REGIONS = new Set(COUNTRIES.filter((c) => c.hasRegions).map((c) => c.code));

// Other ways people write a region. `words` work anywhere; `scoped` only
// when the country is named too, because they clash with Canadian or US
// codes ("Monterrey, NL, Mexico" is Nuevo León, "St. John's, NL" stays
// Newfoundland).
const REGION_ALIASES: { country: CountryCode; code: string; words?: string[]; scoped?: string[] }[] = [
  { country: "CA", code: "PE", words: ["PEI"] },
  { country: "CA", code: "NL", words: ["Newfoundland", "Labrador", "Nfld"] },
  { country: "CA", code: "YT", words: ["Yukon Territory"] },
  { country: "CA", code: "QC", words: ["Que"] },
  { country: "US", code: "DC", words: ["Washington DC", "DC"] },
  { country: "US", code: "PR", words: ["Porto Rico"] },
  { country: "US", code: "VI", words: ["US Virgin Islands", "USVI", "United States Virgin Islands", "Virgin Islands of the United States", "Virgin Islands (U.S.)", "St. Thomas", "St. Croix"] },
  { country: "MX", code: "AGU", words: ["Ags"] },
  { country: "MX", code: "BCN", words: ["Baja California Norte"], scoped: ["BC", "B C"] },
  { country: "MX", code: "BCS", words: ["Baja Sur"], scoped: ["B C S"] },
  { country: "MX", code: "CAM", words: ["Camp"] },
  { country: "MX", code: "CHP", words: ["Chis"] },
  { country: "MX", code: "CHH", words: ["Chih"] },
  { country: "MX", code: "CMX", words: ["CDMX", "DF", "D F", "Mexico City", "Distrito Federal"] },
  { country: "MX", code: "COA", words: ["Coah", "Coahuila de Zaragoza"] },
  { country: "MX", code: "DUR", words: ["Dgo"] },
  { country: "MX", code: "GUA", words: ["Gto"] },
  { country: "MX", code: "HID", words: ["Hgo"] },
  { country: "MX", code: "MEX", words: ["Edomex", "Edo Mex", "Edo de Mex", "Edo. Méx.", "State of Mexico", "Mexico State", "Méx."] },
  { country: "MX", code: "MIC", words: ["Mich", "Michoacán de Ocampo"] },
  { country: "MX", code: "NLE", scoped: ["NL", "N L"] },
  { country: "MX", code: "QUE", words: ["Qro", "Querétaro de Arteaga"], scoped: ["Que"] },
  { country: "MX", code: "ROO", words: ["Q Roo", "QRoo", "QR"] },
  { country: "MX", code: "TAM", words: ["Tamps", "Tamp"] },
  { country: "MX", code: "TLA", words: ["Tlax"] },
  { country: "MX", code: "VER", words: ["Veracruz de Ignacio de la Llave"] },
];

// Every way people name a country at the end of a place. Names and local
// names are added automatically. Two-letter ISO codes are left out on
// purpose: "PA" is Pennsylvania and "MS" is Mississippi.
const COUNTRY_ALIASES: Partial<Record<CountryCode, string[]>> = {
  US: ["USA", "US", "United States of America", "Estados Unidos", "EE.UU.", "EEUU", "États-Unis"],
  MX: ["MX", "Mexique", "Estados Unidos Mexicanos"],
  BZ: ["Belice"],
  BS: ["Bahamas"],
  TT: ["Trinidad", "Tobago", "T&T"],
  AG: ["Antigua", "Barbuda"],
  KN: ["St. Kitts", "Nevis", "St. Kitts-Nevis", "Saint Christopher and Nevis"],
  VC: ["St. Vincent", "SVG", "St. Vincent and Grenadines"],
  KY: ["Cayman", "Caymans", "Grand Cayman"],
  TC: ["Turks and Caicos", "TCI"],
  VG: ["BVI", "Virgin Islands (British)"],
  BQ: ["Bonaire", "Sint Eustatius", "Statia", "Saba", "BES Islands"],
  SX: ["St. Maarten", "Saint Maarten", "Dutch St. Maarten"],
  MF: ["French St. Martin", "Collectivité de Saint-Martin"],
  BL: ["St. Barts", "St. Barths", "St. Barth", "Saint-Barth"],
  HT: ["Ayiti"],
  DO: ["Dominican Rep", "RD"],
  PM: ["St. Pierre and Miquelon", "Saint-Pierre et Miquelon", "SPM"],
  GL: ["Grønland", "Gronland"],
};

function addKey<V>(map: Map<string, V>, k: string, v: V) {
  if (k && !map.has(k)) map.set(k, v);
}

/** Per country with regions: every code, name and alias of its regions. */
const BY_COUNTRY = new Map<CountryCode, Map<string, Region>>();
/** No country named: Canada and the US first, then Mexico where nothing clashes. */
const GLOBAL = new Map<string, Region>();
/** Countries without regions here: their one region. */
const SINGLE = new Map<CountryCode, Region>();
const COUNTRY_WORDS = new Map<string, CountryCode>();

for (const r of REGIONS) {
  if (!WITH_REGIONS.has(r.country)) {
    SINGLE.set(r.country, r);
    continue;
  }
  const m = BY_COUNTRY.get(r.country) ?? new Map<string, Region>();
  BY_COUNTRY.set(r.country, m);
  addKey(m, key(r.code), r);
  addKey(m, key(r.name), r);
}
const findIn = (country: CountryCode, code: string) => REGIONS.find((r) => r.country === country && r.code === code)!;
for (const a of REGION_ALIASES) {
  const r = findIn(a.country, a.code);
  const m = BY_COUNTRY.get(a.country)!;
  for (const w of [...(a.words ?? []), ...(a.scoped ?? [])]) m.set(key(w), r);
}
// Canada and the US keep the plain codes, names and aliases they always had;
// Mexico adds its own only where they don't clash ("que" stays Quebec).
for (const c of ["CA", "US", "MX"] as CountryCode[]) {
  for (const r of REGIONS.filter((x) => x.country === c)) {
    addKey(GLOBAL, key(r.code), r);
    addKey(GLOBAL, key(r.name), r);
  }
  for (const a of REGION_ALIASES.filter((x) => x.country === c)) for (const w of a.words ?? []) addKey(GLOBAL, key(w), findIn(a.country, a.code));
}
for (const c of COUNTRIES) {
  for (const w of [c.name, c.localName, ...(COUNTRY_ALIASES[c.code] ?? [])]) if (w) addKey(COUNTRY_WORDS, key(w), c.code);
}

/** Exact three-letter Mexican state codes, so "Querétaro, QUE" is Querétaro while "Montreal, Que." is Quebec. */
const MX_CODES = new Map(REGIONS.filter((r) => r.country === "MX").map((r) => [r.code, r]));

function findRegion(part: string, country?: Country): Region | undefined {
  const raw = part.trim();
  const k = key(raw);
  if (!k) return undefined;
  if (country) return BY_COUNTRY.get(country.code)?.get(k);
  if (/^[A-Z]{3}$/.test(raw) && MX_CODES.has(raw)) return MX_CODES.get(raw);
  return GLOBAL.get(k);
}

/** A country named at the end of a place ("…, Jamaica", "…, México", "…, USA"). */
function countryWord(part: string): Country | undefined {
  return countryByCode(COUNTRY_WORDS.get(key(part)));
}

interface Parsed {
  /** The city, or the whole text when no region was recognized. */
  city: string;
  region?: Region;
  country?: Country;
  /** The text before a recognized country, when no region was (e.g. "Toluca" in "Toluca, Mexico"). */
  rest?: string;
}

function parseFull(text: string): Parsed {
  const trimmed = text.trim();
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  let country: Country | undefined;
  if (parts.length >= 2) {
    country = countryWord(parts[parts.length - 1]);
    if (country) parts.pop();
  }
  if (country && !country.hasRegions) return { city: parts.join(", "), region: SINGLE.get(country.code), country };
  if (parts.length >= 2) {
    const region = findRegion(parts[parts.length - 1], country);
    if (region) return { city: parts.slice(0, -1).join(", "), region, country: countryByCode(region.country) };
  }
  return country ? { city: trimmed, country, rest: parts.join(", ") } : { city: trimmed };
}

export function regionKey(r: Pick<Region, "country" | "code">): string {
  return `${r.country}:${r.code}`;
}

export function regionByKey(k: string | undefined): Region | undefined {
  if (!k) return undefined;
  const [country, code] = k.split(":");
  return code ? REGIONS.find((r) => r.country === country && r.code === code) : undefined;
}

/**
 * A region by its code: "ON", "TX", "NLE". Without a country, only Canada,
 * the US and Mexico are searched (so "PA" is Pennsylvania); with one, that
 * country's regions are ("PA", "PA" is Panama).
 */
export function regionByCode(code: string | undefined, country?: CountryCode | string): Region | undefined {
  if (!code) return undefined;
  const c = code.trim().toUpperCase();
  const cc = country?.trim().toUpperCase();
  return REGIONS.find((r) => r.code === c && (cc ? r.country === cc : WITH_REGIONS.has(r.country)));
}

/** Every region of a country (one for countries without provinces or states). */
export function regionsOf(country: CountryCode | string): Region[] {
  const c = country.toUpperCase();
  return REGIONS.filter((r) => r.country === c);
}

/**
 * Read "Toronto, ON", "Toronto, Ontario, Canada", "Austin, TX", "Monterrey,
 * NLE", "Monterrey, Nuevo León, México" or "Kingston, Jamaica". Anything else
 * (one word, a country outside North America) comes back as plain text with
 * no region.
 */
export function parsePlace(text: string): { city: string; region?: Region } {
  const p = parseFull(text);
  return p.region ? { city: p.city, region: p.region } : { city: p.city };
}

/** "Toronto" + Ontario → "Toronto, ON"; Monterrey → "Monterrey, NLE"; Kingston → "Kingston, Jamaica". */
export function formatPlace(city: string, region?: Region): string {
  const c = city.trim();
  if (!region || !c) return c;
  return WITH_REGIONS.has(region.country) ? `${c}, ${region.code}` : `${c}, ${region.name}`;
}

export interface ExpandedPlace {
  /** Free-text form for map lookups and Google: "London, Ontario, Canada". */
  query: string;
  /** Set when the place names a known region or country. */
  city?: string;
  /** Province or state, for places in Canada, the US or Mexico. */
  state?: string;
  country?: string;
  /** Lowercase ISO code ("ca", "mx", "pr"), to keep a map lookup inside the right country. */
  countryCode?: string;
}

export function expandPlace(text: string): ExpandedPlace {
  const p = parseFull(text);
  if (p.region) {
    const country = countryByCode(p.region.country)!;
    const countryCode = p.region.osm ?? country.osm;
    // Puerto Rico and the US Virgin Islands are their own country on the map.
    if (country.hasRegions && countryCode === country.osm) {
      return { query: `${p.city}, ${p.region.name}, ${country.name}`, city: p.city, state: p.region.name, country: country.name, countryCode };
    }
    const name = country.hasRegions ? p.region.name : country.name;
    return { query: `${p.city}, ${name}`, city: p.city, country: name, countryCode };
  }
  if (p.country) return { query: p.city, country: p.country.name, countryCode: p.country.osm };
  return { query: text.trim() };
}

export interface Market {
  country: Country;
  region?: Region;
  lang: Lang;
  currency: string;
  timezone: string;
  osm: string;
  tlds: string[];
}

/**
 * What changes with where a business is: its country, region, customers'
 * language, currency, time zone and web domains. A place it can't read
 * falls back to `fallback`'s country.
 */
export function marketOf(place: string, fallback: CountryCode = "US"): Market {
  const p = parseFull(place);
  const country = (p.region ? countryByCode(p.region.country) : p.country) ?? countryByCode(fallback) ?? COUNTRIES[0];
  const region = p.region;
  return {
    country,
    ...(region ? { region } : {}),
    lang: region?.lang ?? country.languages[0],
    currency: country.currency,
    timezone: region?.timezone ?? country.timezone,
    osm: region?.osm ?? country.osm,
    tlds: country.tlds,
  };
}

/**
 * Words a business's own website would mention if it's in this place: the
 * city, the region or country, and Canadian/US codes ("ON", "TX") that
 * addresses use. Accent-free copies are included ("Nuevo Leon"). Unknown
 * places come back as typed.
 */
export function placeWords(place: string): string[] {
  const p = parseFull(place);
  const out: string[] = [];
  if (p.region) {
    out.push(p.city, p.region.name);
    if (p.region.country === "CA" || p.region.country === "US") out.push(p.region.code);
    if (!WITH_REGIONS.has(p.region.country)) {
      const c = countryByCode(p.region.country)!;
      if (c.localName) out.push(c.localName);
    }
  } else if (p.country) {
    if (p.rest) out.push(p.rest);
    out.push(p.country.name);
    if (p.country.localName) out.push(p.country.localName);
  } else {
    out.push(p.city);
  }
  const words = out.map((w) => w.trim()).filter(Boolean);
  return [...new Set([...words, ...words.map(plain)])];
}

// "in Toronto, ON", "near Halifax, Nova Scotia", "around Montréal, QC",
// "in Monterrey, Nuevo León", "in Kingston, Jamaica": any known region or
// country, by code or name, with or without accents, longest first.
const REGION_WORDS = [
  ...new Set([
    ...REGIONS.filter((r) => WITH_REGIONS.has(r.country)).flatMap((r) => [r.name, plain(r.name), r.code]),
    ...COUNTRIES.flatMap((c) => [c.name, plain(c.name), ...(c.localName ? [c.localName, plain(c.localName)] : [])]),
    ...Object.values(COUNTRY_ALIASES)
      .flat()
      .filter((w): w is string => !!w && w.length > 3 && /^\p{Lu}/u.test(w)),
    ...REGION_ALIASES.flatMap((a) => (a.words ?? []).filter((w) => w.length > 3 && /^\p{Lu}/u.test(w))),
  ]),
]
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const CITY_IN_REGION = new RegExp(`\\b(?:in|near|around)\\s+(\\p{Lu}[\\p{L}.'’ -]*?),\\s*(${REGION_WORDS})(?![\\p{L}\\p{N}])`, "u");

/** The place named in a sentence such as an agent's goal, as "City, XX" when it can tell. */
export function placeInText(text: string): string | undefined {
  const m = text.match(CITY_IN_REGION);
  if (m) {
    const p = parseFull(`${m[1]}, ${m[2]}`);
    if (p.region) return formatPlace(p.city, p.region);
    if (p.country) return `${m[1].trim()}, ${p.country.name}`;
  }
  const one = text.match(/\b(?:in|near|around)\s+(\p{Lu}[\p{L}.'’ -]{2,30}?)(?:\s+(?:that|with|who|which)\b|[.!?]|$)/u);
  return one?.[1]?.trim();
}
