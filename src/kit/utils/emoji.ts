/** Curated emoji set with search keywords. Rendered with the system's Apple Color Emoji font. */
export interface EmojiGroup {
  id: string;
  label: string;
  icon: string;
  items: [emoji: string, keywords: string][];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    items: [
      ['😀', 'grin smile happy'], ['😃', 'smile happy joy'], ['😄', 'smile laugh happy'], ['😁', 'grin beam'], ['😆', 'laugh xd'], ['😅', 'sweat relief'],
      ['🤣', 'rofl rolling laugh'], ['😂', 'joy tears laugh'], ['🙂', 'slight smile'], ['😉', 'wink'], ['😊', 'blush smile'], ['😇', 'angel innocent'],
      ['🥰', 'love hearts adore'], ['😍', 'heart eyes love'], ['🤩', 'star struck wow'], ['😘', 'kiss'], ['😋', 'yum tasty'], ['😛', 'tongue'],
      ['😜', 'wink tongue crazy'], ['🤪', 'zany crazy'], ['🤗', 'hug'], ['🤭', 'oops giggle'], ['🤫', 'shh quiet secret'], ['🤔', 'think hmm'],
      ['🤐', 'zipper silent'], ['😐', 'neutral'], ['😑', 'expressionless'], ['😶', 'no mouth'], ['😏', 'smirk'], ['😒', 'unamused'],
      ['🙄', 'eye roll'], ['😬', 'grimace awkward'], ['😌', 'relieved calm'], ['😔', 'pensive sad'], ['😪', 'sleepy'], ['😴', 'sleep zzz'],
      ['😷', 'mask sick'], ['🤒', 'fever sick'], ['🤯', 'mind blown'], ['🥳', 'party celebrate'], ['😎', 'cool sunglasses'], ['🤓', 'nerd'],
      ['🧐', 'monocle curious'], ['😕', 'confused'], ['😟', 'worried'], ['😮', 'wow open mouth'], ['😲', 'astonished shock'], ['🥺', 'pleading please'],
      ['😢', 'cry sad tear'], ['😭', 'sob cry'], ['😱', 'scream fear'], ['😤', 'triumph angry'], ['😡', 'angry mad'], ['🤬', 'swear angry'],
      ['😈', 'devil'], ['💀', 'skull dead'], ['🤡', 'clown'], ['👻', 'ghost'], ['👽', 'alien'], ['🤖', 'robot'],
    ],
  },
  {
    id: 'people',
    label: 'People & gestures',
    icon: '👍',
    items: [
      ['👍', 'thumbs up like yes ok'], ['👎', 'thumbs down dislike no'], ['👏', 'clap applause'], ['🙌', 'raise hands celebrate'], ['🙏', 'pray thanks please'], ['🤝', 'handshake deal'],
      ['👋', 'wave hello bye'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed luck'], ['👌', 'ok perfect'], ['🤌', 'pinched'], ['👉', 'point right'],
      ['👈', 'point left'], ['👆', 'point up'], ['👇', 'point down'], ['☝️', 'index up'], ['✋', 'hand stop'], ['💪', 'muscle strong'],
      ['🫶', 'heart hands love'], ['✍️', 'write'], ['👀', 'eyes look'], ['🧠', 'brain smart'], ['🗣️', 'speak'], ['👶', 'baby'],
      ['👦', 'boy'], ['👧', 'girl'], ['👨', 'man'], ['👩', 'woman'], ['👴', 'old man'], ['👵', 'old woman'],
      ['👨‍💻', 'developer coder'], ['👩‍💻', 'developer coder'], ['👨‍🍳', 'chef cook'], ['👩‍🍳', 'chef cook'], ['👨‍🎓', 'graduate student'], ['👩‍🎓', 'graduate student'],
      ['🧑‍🤝‍🧑', 'friends people'], ['👪', 'family'], ['🏃', 'run'], ['🚶', 'walk'], ['💃', 'dance'], ['🕺', 'dance'],
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts & symbols',
    icon: '❤️',
    items: [
      ['❤️', 'heart love red'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
      ['🖤', 'black heart'], ['🤍', 'white heart'], ['💔', 'broken heart'], ['💕', 'two hearts'], ['💖', 'sparkling heart'], ['💯', 'hundred perfect'],
      ['✅', 'check done yes'], ['☑️', 'checkbox'], ['✔️', 'check'], ['❌', 'cross no wrong'], ['❗', 'exclamation important'], ['❓', 'question'],
      ['⚠️', 'warning caution'], ['⭐', 'star'], ['🌟', 'glowing star'], ['✨', 'sparkles new'], ['🔥', 'fire hot lit'], ['💥', 'boom'],
      ['💡', 'idea bulb'], ['📌', 'pin'], ['📍', 'location pin'], ['🔔', 'bell notification'], ['🎯', 'target goal'], ['🏆', 'trophy win'],
      ['🥇', 'gold first medal'], ['➡️', 'arrow right'], ['⬅️', 'arrow left'], ['⬆️', 'arrow up'], ['⬇️', 'arrow down'], ['🔄', 'repeat refresh'],
      ['🆕', 'new'], ['🆓', 'free'], ['🔝', 'top'], ['💲', 'dollar'], ['%', 'percent'], ['#️⃣', 'hash'],
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    items: [
      ['☀️', 'sun sunny'], ['🌤️', 'partly sunny'], ['☁️', 'cloud'], ['🌧️', 'rain'], ['⛈️', 'storm'], ['❄️', 'snow cold'],
      ['🌈', 'rainbow'], ['🌙', 'moon night'], ['⚡', 'lightning'], ['🌊', 'wave sea'], ['🌸', 'blossom flower'], ['🌹', 'rose'],
      ['🌻', 'sunflower'], ['🌷', 'tulip'], ['🌿', 'herb leaf'], ['🍀', 'clover luck'], ['🌳', 'tree'], ['🌴', 'palm'],
      ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐰', 'rabbit'], ['🦊', 'fox'], ['🐻', 'bear'],
      ['🐼', 'panda'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'], ['🐔', 'chicken'], ['🐦', 'bird'],
      ['🦋', 'butterfly'], ['🐟', 'fish'], ['🐢', 'turtle'], ['🐝', 'bee'], ['🌍', 'earth world'], ['🌱', 'seedling grow'],
    ],
  },
  {
    id: 'food',
    label: 'Food & drink',
    icon: '🍔',
    items: [
      ['🍎', 'apple'], ['🍌', 'banana'], ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🥭', 'mango'],
      ['🍍', 'pineapple'], ['🥥', 'coconut'], ['🍅', 'tomato'], ['🥕', 'carrot'], ['🌶️', 'chili hot'], ['🥑', 'avocado'],
      ['🍞', 'bread'], ['🧀', 'cheese'], ['🍗', 'chicken leg'], ['🍖', 'meat'], ['🍔', 'burger'], ['🍟', 'fries'],
      ['🍕', 'pizza'], ['🌭', 'hotdog'], ['🌮', 'taco'], ['🍛', 'curry rice'], ['🍚', 'rice'], ['🍜', 'noodles ramen'],
      ['🍣', 'sushi'], ['🥟', 'dumpling'], ['🍰', 'cake'], ['🎂', 'birthday cake'], ['🍩', 'donut'], ['🍪', 'cookie'],
      ['🍫', 'chocolate'], ['🍦', 'ice cream'], ['☕', 'coffee tea'], ['🍵', 'tea'], ['🥤', 'drink soda'], ['🧃', 'juice'],
    ],
  },
  {
    id: 'activity',
    label: 'Activities & travel',
    icon: '🎉',
    items: [
      ['🎉', 'party tada celebrate'], ['🎊', 'confetti'], ['🎁', 'gift present'], ['🎈', 'balloon'], ['🎄', 'christmas tree'], ['🎃', 'pumpkin halloween'],
      ['⚽', 'football soccer'], ['🏏', 'cricket'], ['🏀', 'basketball'], ['🏸', 'badminton'], ['🎮', 'game'], ['🎵', 'music note'],
      ['🎶', 'music'], ['🎤', 'mic sing'], ['🎧', 'headphones'], ['🎬', 'movie film'], ['📷', 'camera photo'], ['🎨', 'art paint'],
      ['✈️', 'plane travel flight'], ['🚗', 'car'], ['🚌', 'bus'], ['🚲', 'bicycle'], ['🚀', 'rocket launch'], ['🏠', 'home house'],
      ['🏢', 'office building'], ['🏖️', 'beach'], ['⛰️', 'mountain'], ['🕌', 'mosque'], ['🗺️', 'map'], ['🧳', 'luggage travel'],
    ],
  },
  {
    id: 'objects',
    label: 'Work & objects',
    icon: '💼',
    items: [
      ['💼', 'work briefcase business'], ['📝', 'note memo write'], ['📋', 'clipboard list'], ['📅', 'calendar date'], ['🗓️', 'calendar'], ['⏰', 'alarm clock time'],
      ['⏳', 'hourglass wait'], ['📈', 'chart up growth'], ['📉', 'chart down'], ['📊', 'bar chart stats'], ['💰', 'money bag'], ['💳', 'card payment'],
      ['🧾', 'receipt'], ['🛒', 'cart shopping'], ['🛍️', 'shopping bags'], ['📦', 'package box'], ['🚚', 'delivery truck'], ['🏷️', 'tag price'],
      ['💻', 'laptop computer'], ['🖥️', 'desktop computer'], ['📱', 'phone mobile'], ['⌨️', 'keyboard'], ['🖱️', 'mouse computer'], ['🔒', 'lock secure'],
      ['🔑', 'key'], ['🔧', 'wrench tool'], ['🛠️', 'tools build'], ['⚙️', 'gear settings'], ['🐞', 'bug'], ['📎', 'paperclip attach'],
      ['✏️', 'pencil'], ['📚', 'books study'], ['📖', 'book read'], ['📣', 'megaphone announce'], ['📢', 'loudspeaker'], ['✉️', 'email mail'],
      ['📞', 'phone call'], ['🔗', 'link'], ['🗂️', 'folders'], ['📁', 'folder'], ['🗑️', 'trash'], ['🧹', 'broom clean'],
    ],
  },
  {
    id: 'flags',
    label: 'Flags',
    icon: '🏳️',
    items: [
      ['🇧🇩', 'bangladesh flag'], ['🇮🇳', 'india flag'], ['🇵🇰', 'pakistan flag'], ['🇸🇦', 'saudi flag'], ['🇦🇪', 'uae flag'], ['🇺🇸', 'usa flag'],
      ['🇬🇧', 'uk flag'], ['🇨🇦', 'canada flag'], ['🇦🇺', 'australia flag'], ['🇲🇾', 'malaysia flag'], ['🇸🇬', 'singapore flag'], ['🇯🇵', 'japan flag'],
      ['🏁', 'checkered finish'], ['🚩', 'red flag'], ['🏳️', 'white flag'], ['🏴', 'black flag'],
    ],
  },
];

export function searchEmoji(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out: string[] = [];
  for (const g of EMOJI_GROUPS) for (const [e, k] of g.items) if (k.includes(s)) out.push(e);
  return out;
}

const RECENT_KEY = 'mackit.recentEmoji';

export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string): void {
  try {
    const next = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}
