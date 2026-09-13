function createIcon() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#6c63ff');
  grad.addColorStop(1, '#e91e63');
  ctx.fillStyle = grad;
  
  // Rounded rect
  ctx.beginPath();
  ctx.moveTo(24, 0);
  ctx.lineTo(104, 0);
  ctx.quadraticCurveTo(128, 0, 128, 24);
  ctx.lineTo(128, 104);
  ctx.quadraticCurveTo(128, 128, 104, 128);
  ctx.lineTo(24, 128);
  ctx.quadraticCurveTo(0, 128, 0, 104);
  ctx.lineTo(0, 24);
  ctx.quadraticCurveTo(0, 0, 24, 0);
  ctx.closePath();
  ctx.fill();
  
  // Text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 38px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('UP', 64, 55);
  
  ctx.font = 'bold 22px Arial';
  ctx.fillText('CUSTOM', 64, 85);
  
  // Arrow
  ctx.beginPath();
  ctx.moveTo(64, 92);
  ctx.lineTo(54, 108);
  ctx.lineTo(74, 108);
  ctx.closePath();
  ctx.fill();
  
  return canvas;
}