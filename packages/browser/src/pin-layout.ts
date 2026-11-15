type Point = {x:number;y:number};
export function placePin(point:Point,placed:Point[],viewport:{width:number;height:number}):Point {
  const radius = 16, gap = 34, minX = Math.min(radius,viewport.width / 2), minY = Math.min(radius,viewport.height / 2);
  const origin = {x:Math.max(minX,Math.min(point.x,viewport.width-minX)),y:Math.max(minY,Math.min(point.y,viewport.height-minY))};
  const available = (candidate:Point) => candidate.x >= minX && candidate.x <= viewport.width-minX && candidate.y >= minY && candidate.y <= viewport.height-minY && placed.every(other => (candidate.x-other.x)**2+(candidate.y-other.y)**2 >= gap**2);
  // Move only the badge; the stored element anchor and its coordinates stay intact.
  const rings = Math.min(placed.length+1,Math.ceil(Math.max(viewport.width,viewport.height)/gap));
  for(let ring=0;ring<=rings;ring++) for(let row=-ring;row<=ring;row++) for(let column=-ring;column<=ring;column++) {
    if(Math.max(Math.abs(row),Math.abs(column))!==ring) continue;
    const candidate = {x:origin.x+column*gap,y:origin.y+row*gap}; if(available(candidate)) return candidate;
  }
  return origin;
}
