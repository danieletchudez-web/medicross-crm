import sharp from "sharp";
import { readFileSync } from "fs";

const svg = readFileSync("public/app-icon-maskable.svg");
const svgTransparent = readFileSync("public/app-icon.svg");

await sharp(svg).resize(512, 512).png().toFile("public/app-icon-512.png");
await sharp(svg).resize(512, 512).png().toFile("public/app-icon-maskable-512.png");
await sharp(svg).resize(192, 192).png().toFile("public/app-icon-192.png");
await sharp(svg).resize(180, 180).png().toFile("public/apple-touch-icon.png");

await sharp(svg).resize(32, 32).png().toFile("public/favicon-32.png");

console.log("Icons generated.");
