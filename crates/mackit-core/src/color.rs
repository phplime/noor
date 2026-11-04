use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Straight (non‑premultiplied) RGBA color, serialized as `#rrggbb` or `#rrggbbaa`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Color {
    pub const WHITE: Color = Color::rgb(255, 255, 255);
    pub const BLACK: Color = Color::rgb(0, 0, 0);
    pub const TRANSPARENT: Color = Color {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };

    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Color { r, g, b, a: 255 }
    }

    pub fn to_array(self) -> [u8; 4] {
        [self.r, self.g, self.b, self.a]
    }

    pub fn parse(s: &str) -> Option<Color> {
        let hex = s.trim().strip_prefix('#')?;
        let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
        let nib = |i: usize| {
            let v = u8::from_str_radix(hex.get(i..i + 1)?, 16).ok()?;
            Some(v * 17)
        };
        match hex.len() {
            3 => Some(Color::rgb(nib(0)?, nib(1)?, nib(2)?)),
            6 => Some(Color::rgb(byte(0)?, byte(2)?, byte(4)?)),
            8 => Some(Color {
                r: byte(0)?,
                g: byte(2)?,
                b: byte(4)?,
                a: byte(6)?,
            }),
            _ => None,
        }
    }
}

impl fmt::Display for Color {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.a == 255 {
            write!(f, "#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
        } else {
            write!(
                f,
                "#{:02x}{:02x}{:02x}{:02x}",
                self.r, self.g, self.b, self.a
            )
        }
    }
}

impl Serialize for Color {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Color {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Color::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("invalid color '{s}'")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_forms() {
        assert_eq!(Color::parse("#fff"), Some(Color::WHITE));
        assert_eq!(Color::parse("#102030"), Some(Color::rgb(16, 32, 48)));
        assert_eq!(
            Color::parse("#10203080"),
            Some(Color {
                r: 16,
                g: 32,
                b: 48,
                a: 128
            })
        );
        assert_eq!(Color::parse("102030"), None);
        assert_eq!(Color::parse("#12345"), None);
        assert_eq!(Color::parse("#gggggg"), None);
    }

    #[test]
    fn round_trips() {
        let c = Color {
            r: 1,
            g: 2,
            b: 3,
            a: 4,
        };
        assert_eq!(Color::parse(&c.to_string()), Some(c));
    }
}
