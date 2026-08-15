const $=id=>document.getElementById(id);
const video=$("camera"),stage=$("stage"),overlay=$("overlayCanvas"),cal=$("calibrationCanvas");
const input=$("imageInput"),startBtn=$("startBtn"),lockBtn=$("lockBtn"),unlockBtn=$("unlockBtn");
const opacity=$("opacity"),opacityOut=$("opacityOut"),statusEl=$("status"),hint=$("stageHint"),lockBadge=$("canvasLock"),tracking=$("trackingStatus");
let stream=null,reference=null,corners=[],locked=false,trackingOn=false,prevGray=null,prevPts=null,lastTrack=0,animationId=null;
const refCanvas=document.createElement("canvas");
let overlayCtx=overlay.getContext("2d");

input.addEventListener("change",e=>{
 const f=e.target.files?.[0];if(!f)return;
 reference=new Image();reference.onload=()=>{
  refCanvas.width=reference.naturalWidth;refCanvas.height=reference.naturalHeight;
  refCanvas.getContext("2d").drawImage(reference,0,0);
  $("setup").classList.add("hidden");stage.classList.remove("hidden");
  statusEl.textContent="Start the camera, then tap the 4 corners of your canvas.";
  resizeCanvases();
 };reference.src=URL.createObjectURL(f);
});

startBtn.onclick=async()=>{
 try{
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
  video.srcObject=stream;await video.play();resizeCanvases();
  startBtn.textContent="Camera on";startBtn.disabled=true;
  statusEl.textContent="Tap the 4 corners of your physical canvas, clockwise.";
  hint.textContent="Tap the 4 canvas corners, clockwise";
  cal.classList.remove("hidden");
 }catch(e){alert("Camera access was blocked. Allow Camera for this site in Safari.")}
};

function resizeCanvases(){
 const r=stage.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);
 [overlay,cal].forEach(c=>{c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.style.width=r.width+"px";c.style.height=r.height+"px"});
 drawCalibration();
}
window.addEventListener("resize",()=>{if(!locked)resizeCanvases()});

function videoToStage(p){
 const vw=video.videoWidth||1280,vh=video.videoHeight||720,sw=stage.clientWidth,sh=stage.clientHeight;
 const s=Math.max(sw/vw,sh/vh),dw=vw*s,dh=vh*s,ox=(sw-dw)/2,oy=(sh-dh)/2;
 return{x:p.x*s+ox,y:p.y*s+oy};
}
function stageToVideo(p){
 const vw=video.videoWidth||1280,vh=video.videoHeight||720,sw=stage.clientWidth,sh=stage.clientHeight;
 const s=Math.max(sw/vw,sh/vh),dw=vw*s,dh=vh*s,ox=(sw-dw)/2,oy=(sh-dh)/2;
 return{x:(p.x-ox)/s,y:(p.y-oy)/s};
}
function drawCalibration(){
 const ctx=cal.getContext("2d"),d=Math.min(devicePixelRatio||1,2);ctx.clearRect(0,0,cal.width,cal.height);ctx.save();ctx.scale(d,d);
 corners.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,12,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();ctx.strokeStyle="#111";ctx.lineWidth=3;ctx.stroke();ctx.fillStyle="#111";ctx.font="bold 12px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(i+1),p.x,p.y)});
 if(corners.length>1){ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);corners.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));if(corners.length===4)ctx.closePath();ctx.strokeStyle="rgba(255,255,255,.9)";ctx.lineWidth=2;ctx.stroke()}ctx.restore();
}

cal.addEventListener("pointerdown",e=>{
 if(locked||!reference||!stream||corners.length>=4)return;
 const r=cal.getBoundingClientRect();corners.push({x:e.clientX-r.left,y:e.clientY-r.top});drawCalibration();
 if(corners.length===4){lockBtn.disabled=false;statusEl.textContent="Canvas calibrated. Tap Lock canvas.";hint.textContent="4 corners set — tap Lock canvas"}
});

opacity.oninput=()=>{opacityOut.textContent=opacity.value+"%";if(locked&&window.cv?.Mat)renderReference()};

lockBtn.onclick=async()=>{
 if(corners.length!==4)return;
 if(!window.cv||!cv.Mat){statusEl.textContent="Loading the tracing engine… please wait a second and tap Lock canvas again.";return}
 locked=true;lockBtn.classList.add("hidden");unlockBtn.classList.remove("hidden");cal.classList.add("hidden");lockBadge.classList.remove("hidden");tracking.classList.remove("hidden");
 statusEl.textContent="Canvas locked. The reference is now fixed to those 4 canvas corners.";hint.textContent="Move slowly — canvas locked";
 // IMPORTANT: render the reference immediately when locking, before tracking starts.
 renderReference();
 startTracking();
};

unlockBtn.onclick=()=>unlock();
$("resetBtn").onclick=()=>unlock(true);
function unlock(reset=false){
 locked=false;trackingOn=false;if(animationId)cancelAnimationFrame(animationId);animationId=null;
 unlockBtn.classList.add("hidden");lockBtn.classList.remove("hidden");lockBtn.disabled=reset;lockBadge.classList.add("hidden");tracking.classList.add("hidden");
 prevGray?.delete?.();prevPts?.delete?.();prevGray=null;prevPts=null;clearOverlay();
 if(reset){corners=[];drawCalibration();statusEl.textContent="Reset. Start again by tapping the 4 canvas corners.";hint.textContent="Tap the 4 canvas corners, clockwise"}
 else{drawCalibration();statusEl.textContent="Canvas unlocked. Recalibrate if you need to change it.";hint.textContent="Tap the 4 canvas corners, clockwise"}
}
$("gridBtn").onclick=()=>stage.classList.toggle("grid-on");
function clearOverlay(){overlayCtx.clearRect(0,0,overlay.width,overlay.height)}
function makeSourceMat(){
 const max=900,s=Math.min(1,max/refCanvas.width,max/refCanvas.height),w=Math.max(1,Math.round(refCanvas.width*s)),h=Math.max(1,Math.round(refCanvas.height*s));
 const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(refCanvas,0,0,w,h);return cv.imread(c);
}
function renderReference(){
 if(!reference||corners.length!==4||!window.cv?.Mat)return;
 const vw=video.videoWidth||1280,vh=video.videoHeight||720;
 const frame=new cv.Mat(vh,vw,cv.CV_8UC4,new cv.Scalar(0,0,0,0));
 drawOverlay(frame,corners);frame.delete();
}
function getDst(){return corners.map(p=>stageToVideo(p))}

function startTracking(){
 trackingOn=true;prevGray?.delete?.();prevPts?.delete?.();prevGray=new cv.Mat();
 const cap=new cv.VideoCapture(video),src=new cv.Mat(video.videoHeight,video.videoWidth,cv.CV_8UC4);cap.read(src);cv.cvtColor(src,prevGray,cv.COLOR_RGBA2GRAY);
 const arr=getDst();prevPts=cv.matFromArray(4,1,cv.CV_32FC2,arr.flatMap(p=>[p.x,p.y]));src.delete();
 if(animationId)cancelAnimationFrame(animationId);animationId=requestAnimationFrame(trackLoop);
}
function trackLoop(t){
 if(!trackingOn||!locked)return;if(t-lastTrack<100){animationId=requestAnimationFrame(trackLoop);return}lastTrack=t;
 try{
  const cap=new cv.VideoCapture(video),frame=new cv.Mat(video.videoHeight,video.videoWidth,cv.CV_8UC4),gray=new cv.Mat();cap.read(frame);cv.cvtColor(frame,gray,cv.COLOR_RGBA2GRAY);
  if(prevGray&&prevPts&&prevPts.rows===4){
   const next=new cv.Mat(),st=new cv.Mat(),err=new cv.Mat();cv.calcOpticalFlowPyrLK(prevGray,gray,prevPts,next,st,err,new cv.Size(21,21),3,new cv.TermCriteria(cv.TERM_CRITERIA_EPS|cv.TERM_CRITERIA_COUNT,30,.01));
   let good=0;const pts=[];
   for(let i=0;i<4;i++){if(st.data[i]){pts.push({x:next.data32F[i*2],y:next.data32F[i*2+1]});good++}else pts.push(getDst()[i])}
   if(good>=3){corners=pts.map(videoToStage);drawCalibration();renderReference();prevPts.delete();prevPts=next.clone();tracking.textContent=good===4?"● Tracking":"● Tracking (partial)"}
   else{tracking.textContent="⚠ Tracking weak — hold phone steady"}
   next.delete();st.delete();err.delete();
  }
  gray.copyTo(prevGray);frame.delete();gray.delete();
 }catch(e){tracking.textContent="⚠ Tracking unavailable"}
 animationId=requestAnimationFrame(trackLoop);
}
