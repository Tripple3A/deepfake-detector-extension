// content-capture.js
// This file contains all the video capture functions that will be injected into the page

// Expose functions to window so they can be called after injection
window.captureVideoFrames = captureVideoFrames;
window.captureVideoWithFallbacks = captureVideoWithFallbacks;
window.findMainVideoElement = findMainVideoElement;
window.createCaptureOverlay = createCaptureOverlay;
window.showCaptureInstructions = showCaptureInstructions;
window.stopAllTracks = stopAllTracks;
window.monitorCapturePosition = monitorCapturePosition;

/**
 * Pre-checks if standard capture is likely to work without showing UI
 * @returns {Promise<{canUseStandard: boolean, videoElement: HTMLVideoElement|null, error: string|null}>}
 */
async function precheckStandardCapture() {
  console.log("Pre-checking if standard capture is possible...");
  
  try {
    // Find the main video element
    const videoElement = findMainVideoElement();
    if (!videoElement) {
      return {
        canUseStandard: false,
        videoElement: null,
        error: "No video element found on page"
      };
    }
    
    // Check if video has valid dimensions
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      return {
        canUseStandard: false,
        videoElement: videoElement,
        error: "Video element does not have valid dimensions"
      };
    }
    
    // Check if video has accessible duration
    const hasDuration = videoElement.duration && 
                       isFinite(videoElement.duration) && 
                       videoElement.duration > 0;
                       
    if (!hasDuration) {
      return {
        canUseStandard: false,
        videoElement: videoElement,
        error: "Video duration is not accessible"
      };
    }
    
    // Create a small canvas for testing
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 10;  // Very small canvas for the test
    testCanvas.height = 10;
    const ctx = testCanvas.getContext('2d');
    
    // Try to draw a single frame from the video
    try {
      // Save current video state
      const wasPlaying = !videoElement.paused;
      
      // Try to draw video to canvas
      ctx.drawImage(videoElement, 0, 0, 10, 10);
      
      // Try to read pixel data (this will fail if cross-origin restrictions apply)
      ctx.getImageData(0, 0, 1, 1);
      
      // Return success
      return {
        canUseStandard: true,
        videoElement: videoElement,
        error: null
      };
    } catch (e) {
      console.log("Pre-check canvas access failed:", e);
      return {
        canUseStandard: false,
        videoElement: videoElement,
        error: "Canvas access error: " + e.message
      };
    }
  } catch (e) {
    console.error("Error during capture pre-check:", e);
    return {
      canUseStandard: false,
      videoElement: null,
      error: "Pre-check error: " + e.message
    };
  }
}



// Frame capture function that properly samples frames based on video length and frame rate
// Enhanced frame capture function with face detection
function captureVideoFrames() {
  console.log("Starting enhanced frame capture with face detection...");
  
  return new Promise(async (mainResolve, mainReject) => {
    try {
      // Find all videos on the page
      const videos = document.querySelectorAll('video');
      console.log(`Found ${videos.length} videos on page`);
      
      if (!videos || videos.length === 0) {
        return mainResolve({ 
          frames: [], 
          width: 0, 
          height: 0, 
          error: "No video found on page",
          needsWebRTC: true
        });
      }
      
      // Find the main video (playing or largest visible)
      let targetVideo = null;
      
      // First try to find a playing video
      for (const video of videos) {
        if (!video.paused && video.currentTime > 0) {
          console.log("Found playing video");
          targetVideo = video;
          break;
        }
      }
      
      // If no playing video, find the largest visible video
      if (!targetVideo) {
        let maxSize = 0;
        
        for (const video of videos) {
          const rect = video.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && 
                          rect.top < window.innerHeight && rect.bottom > 0 &&
                          rect.left < window.innerWidth && rect.right > 0;
          
          if (isVisible) {
            const size = video.videoWidth * video.videoHeight || rect.width * rect.height;
            if (size > maxSize) {
              maxSize = size;
              targetVideo = video;
            }
          }
        }
      }
      
      // If still no target video, use the first one as a fallback
      if (!targetVideo && videos.length > 0) {
        targetVideo = videos[0];
      }
      
      if (!targetVideo) {
        return mainResolve({ 
          frames: [], 
          width: 0, 
          height: 0, 
          error: "No suitable video found",
          needsWebRTC: true
        });
      }
      
      const video = targetVideo;
      
      // Check if we have a valid duration
      if (!video.duration || !isFinite(video.duration) || video.duration <= 0) {
        console.log("Video duration unavailable, will need to use WebRTC fallback");
        return mainResolve({ 
          frames: [], 
          width: video.videoWidth || 640,
          height: video.videoHeight || 360, 
          error: "Video duration unavailable - cannot sample frames",
          securityError: true,
          needsWebRTC: true
        });
      }
      
      console.log(`Selected video: ${video.videoWidth}x${video.videoHeight}, duration: ${video.duration.toFixed(2)}s`);
      
      // Store original state
      const originalTime = video.currentTime;
      const wasPlaying = !video.paused;
      
      // If video is playing, pause it temporarily
      if (wasPlaying) {
        video.pause();
      }
      
      // Creating canvas for capture
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      // ===== CALCULATING PROPER SAMPLING RATE =====
      
      // Estimate frame rate: most videos are either 24, 30, or 60 fps
      // If we can't determine it, we assume 30fps
      let frameRate = 30;
      if (video.getVideoPlaybackQuality) {
        const quality = video.getVideoPlaybackQuality();
        if (quality.totalVideoFrames && quality.totalVideoFrames > 0 && video.currentTime > 0) {
          frameRate = Math.round(quality.totalVideoFrames / video.currentTime);
          frameRate = Math.min(Math.max(frameRate, 24), 60); // Keep between 24-60fps
        }
      }
      
      console.log(`Estimated video frame rate: ${frameRate}fps`);
      
      // Calculate total frames in video
      const totalFramesInVideo = Math.ceil(video.duration * frameRate);
      console.log(`Total frames in video (estimated): ${totalFramesInVideo}`);
      
      // Determine how many frames to capture based on video duration
      let targetFrameCount;
      let captureInterval;
      
      // Adjust frame count based on video duration - enhanced for better coverage
      if (video.duration < 3) {
        // Very short video: capture frames densely
        captureInterval = Math.max(1, Math.floor(frameRate / 6)); // About 6 frames per second
        targetFrameCount = Math.ceil(video.duration * 6);
      } else if (video.duration < 10) {
        // Short video: capture more frequently
        captureInterval = Math.max(1, Math.floor(frameRate / 4)); // About 4 frames per second
        targetFrameCount = Math.ceil(video.duration * 4);
      } else if (video.duration < 60) {
        // Medium video: capture regularly
        captureInterval = Math.max(1, Math.floor(frameRate / 3)); // About 3 frames per second
        targetFrameCount = Math.ceil(video.duration * 3);
      } else if (video.duration < 300) {
        // Long video: be more selective
        captureInterval = Math.max(1, Math.floor(frameRate / 2)); // About 2 frames per second
        targetFrameCount = Math.ceil(video.duration * 2);
      } else {
        // Very long video: be even more selective
        captureInterval = Math.max(1, Math.floor(frameRate)); // About 1 frame per second
        targetFrameCount = Math.ceil(video.duration);
      }
      
      // Ensure we don't exceed maximum frame capacity but get enough frames
      targetFrameCount = Math.max(20, Math.min(targetFrameCount, 300)); // Reduced from 600 to 300 for efficiency
      
      // Recalculate interval to evenly space initial frames
      captureInterval = Math.max(1, Math.floor(totalFramesInVideo / targetFrameCount));
      
      console.log(`Initial plan: capture ~${targetFrameCount} frames at intervals of ~${captureInterval} frames (every ${(captureInterval/frameRate).toFixed(2)}s)`);
      
      // ===== PREPARE FACE DETECTION (if available) =====
      let faceDetector = null;
      let faceDetectionSupported = false;
      
      try {
        // Check if face detection is supported
        if (window.FaceDetector) {
          faceDetector = new FaceDetector({
            // Balanced setting for performance vs. accuracy
            maxDetectedFaces: 5,
            fastMode: true
          });
          faceDetectionSupported = true;
          console.log("Face detection is supported and enabled");
        } else {
          console.log("Face detection API not available in this browser");
        }
      } catch (e) {
        console.log("Face detection initialization failed:", e);
      }
      
      // ===== CAPTURE FRAMES =====
      
      const frames = [];
      const capturePositions = [];
      const frameHashes = new Set(); // To detect duplicate frames
      const facialFrames = []; // To store frames that contain faces
      
      // Function to check if a frame contains faces
      const detectFaces = async (imgData) => {
        if (!faceDetectionSupported || !faceDetector) {
          return { hasFaces: false, faceCount: 0 };
        }
        
        try {
          // Create an image from the data URL for face detection
          const img = new Image();
          img.src = imgData;
          
          // Wait for the image to load
          await new Promise(resolve => {
            img.onload = resolve;
          });
          
          // Detect faces
          const faces = await faceDetector.detect(img);
          return { hasFaces: faces.length > 0, faceCount: faces.length };
        } catch (e) {
          console.log("Face detection error:", e);
          return { hasFaces: false, faceCount: 0 };
        }
      };

      // Enhanced frame capture function with better error handling
      const captureFrameAtTime = (timePosition) => {
        return new Promise((resolve, reject) => {
          // Skip if too close to the end
          if (timePosition >= video.duration - 0.1) {
            return resolve({ skipped: true, reason: "Too close to end" });
          }
          
          // Use proper event handler for seeking
          const seekHandler = () => {
            try {
              video.removeEventListener('seeked', seekHandler);
              
              // Draw frame to canvas - with proper error handling for cross-origin issues
              try {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                // Generate a simple frame hash to check for duplicates
                let hash = 0;
                try {
                  const pixelData = ctx.getImageData(0, 0, 20, 20).data; // Small sample for speed
                  for (let i = 0; i < pixelData.length; i += 20) {
                    hash = ((hash << 5) - hash) + pixelData[i];
                    hash = hash & hash; // Convert to 32bit integer
                  }
                } catch (pixelError) {
                  // This might occur on cross-origin videos - just use a simple timestamp-based hash
                  console.warn("Unable to get pixel data for hash, using fallback hash method:", pixelError);
                  hash = Math.floor(timePosition * 100); // Use the time position as a fallback hash
                }
                
                // Calculate capture quality based on resolution
                const videoSize = canvas.width * canvas.height;
                const jpegQuality = videoSize > 1280 * 720 ? 0.7 : 0.85;
                
                // Try to get the data URL, with fallback for cross-origin videos
                let frameDataUrl;
                try {
                  frameDataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
                } catch (dataUrlError) {
                  console.error("Error creating dataURL:", dataUrlError);
                  // If we can't get a data URL due to security restrictions,
                  // we'll resolve with a special indicator
                  return resolve({
                    skipped: true,
                    reason: "Cross-origin restrictions prevented frame capture",
                    error: dataUrlError.toString(),
                    securityError: true,
                    needsWebRTC: true
                  });
                }
                
                resolve({
                  frame: frameDataUrl,
                  position: timePosition,
                  hash: hash
                });
              } catch (drawError) {
                console.error("Error drawing video to canvas:", drawError);
                resolve({
                  skipped: true, 
                  reason: "Error drawing video to canvas: " + drawError.toString(),
                  error: drawError.toString(),
                  securityError: drawError.toString().includes("SecurityError"),
                  needsWebRTC: drawError.toString().includes("SecurityError")
                });
              }
            } catch (e) {
              console.error("Error in frame capture:", e);
              reject(e);
            }
          };
          
          // Set up event listener for seeking completion
          video.addEventListener('seeked', seekHandler);
          
          // Start seeking with error handling
          try {
            video.currentTime = timePosition;
          } catch (seekError) {
            console.error("Error seeking to position:", seekError);
            video.removeEventListener('seeked', seekHandler);
            resolve({
              skipped: true,
              reason: "Error seeking to position: " + seekError.toString(),
              error: seekError.toString(),
              securityError: seekError.toString().includes("SecurityError"),
              needsWebRTC: seekError.toString().includes("SecurityError")
            });
          }
          
          // Set a timeout in case seeking never completes
          setTimeout(() => {
            video.removeEventListener('seeked', seekHandler);
            resolve({ 
              skipped: true, 
              reason: `Seek timeout at position ${timePosition.toFixed(2)}s`,
              error: "Seek timeout"
            });
          }, 1000); // Extended timeout to 1000ms to accommodate slower sites
        });
      };
      
      // First-pass: Capture initial set of frames evenly distributed
      const initialFrameCount = Math.min(targetFrameCount, 60); // Reduced from 100 to 60 for efficiency
      
      console.log(`First pass: Capturing ${initialFrameCount} evenly distributed frames`);
      
      // Track security errors to decide if WebRTC is needed
      let securityErrorCount = 0;
      let captureSuccessCount = 0;
      
      // Capture frames in sequence with proper error handling
      for (let i = 0; i < initialFrameCount; i++) {
        try {
          // Calculate position - ensure even distribution
          const frameIndex = Math.min(i * captureInterval, totalFramesInVideo - 1);
          const timePosition = frameIndex / frameRate;
          
          // Capture the frame
          console.log(`Capturing frame ${i+1}/${initialFrameCount} at approx ${timePosition.toFixed(2)}s (frame ${frameIndex})`);
          
          const result = await captureFrameAtTime(timePosition);
          
          if (result.skipped) {
            console.log(`Skipped frame at ${timePosition.toFixed(2)}s: ${result.reason}`);
            
            // Check if this was a security error
            if (result.securityError) {
              securityErrorCount++;
              
              // If we've had multiple security errors, bail out early to save time
              if (securityErrorCount >= 3) {
                console.log("Multiple security errors detected, switching to WebRTC fallback");
                return mainResolve({
                  frames: [],
                  width: canvas.width,
                  height: canvas.height,
                  error: "Security restrictions prevented standard capture",
                  securityError: true,
                  needsWebRTC: true
                });
              }
            }
            
            continue;
          }
          
          capturePositions.push(timePosition);
          captureSuccessCount++;
          
          // Only add the frame if it's not a duplicate
          if (!frameHashes.has(result.hash)) {
            frames.push(result.frame);
            frameHashes.add(result.hash);
            
            // Check if frame contains faces (if supported)
            if (faceDetectionSupported) {
              const faceResult = await detectFaces(result.frame);
              if (faceResult.hasFaces) {
                facialFrames.push({
                  frame: result.frame,
                  position: timePosition,
                  faceCount: faceResult.faceCount
                });
                console.log(`Detected ${faceResult.faceCount} faces at ${timePosition.toFixed(2)}s`);
              }
            }
            
            console.log(`Added unique frame at ${timePosition.toFixed(2)}s (hash: ${result.hash})`);
          } else {
            console.log(`Skipped duplicate frame at ${timePosition.toFixed(2)}s (hash: ${result.hash})`);
          }
        } catch (error) {
          console.error(`Error capturing frame ${i+1}:`, error);
          // Continue to next frame on error
        }
      }
      
      // Early check - if we've had almost no successful captures, switch to WebRTC
      if (captureSuccessCount < 3 && securityErrorCount > 0) {
        console.log("Too few successful captures with security errors, switching to WebRTC fallback");
        return mainResolve({
          frames: [], 
          width: canvas.width, 
          height: canvas.height, 
          error: "Standard capture failed - security restrictions",
          securityError: true,
          needsWebRTC: true
        });
      }
      
      // Second-pass: Focus on key moments and face detection
      // But only if we have enough good frames from the first pass
      if (frames.length >= 5) {
        const keyPositions = [
          0.1, // Near start
          video.duration * 0.25, // First quarter
          video.duration * 0.5,  // Middle
          video.duration * 0.75, // Third quarter
          Math.max(0, video.duration - 0.5) // Near end
        ];
        
        console.log(`Second pass: Capturing ${keyPositions.length} key frames and focusing on faces`);
        
        // Process key positions
        for (const keyPosition of keyPositions) {
          // Only add if not too close to existing captures
          const isTooClose = capturePositions.some(pos => Math.abs(pos - keyPosition) < 0.3);
          
          if (!isTooClose) {
            try {
              console.log(`Capturing key frame at ${keyPosition.toFixed(2)}s`);
              const result = await captureFrameAtTime(keyPosition);
              
              if (!result.skipped && !frameHashes.has(result.hash)) {
                frames.push(result.frame);
                capturePositions.push(keyPosition);
                frameHashes.add(result.hash);
                
                // Check for faces
                if (faceDetectionSupported) {
                  const faceResult = await detectFaces(result.frame);
                  if (faceResult.hasFaces) {
                    facialFrames.push({
                      frame: result.frame,
                      position: keyPosition,
                      faceCount: faceResult.faceCount
                    });
                    console.log(`Detected ${faceResult.faceCount} faces in key frame at ${keyPosition.toFixed(2)}s`);
                  }
                }
                
                console.log(`Added key frame at ${keyPosition.toFixed(2)}s`);
              }
            } catch (error) {
              console.error(`Error capturing key frame at ${keyPosition.toFixed(2)}s:`, error);
            }
          }
        }
      }
      
      // If face detection is supported, prioritize facial frames
      if (faceDetectionSupported && facialFrames.length > 0) {
        console.log(`Face detection found ${facialFrames.length} frames with faces`);
        
        // Sort by face count (descending)
        facialFrames.sort((a, b) => b.faceCount - a.faceCount);
        
        // Add a few more frames from the most face-rich areas if needed
        if (frames.length < 20 && facialFrames.length > 0) {
          // Focus on the frames with the most faces
          const topFacialFrames = facialFrames.slice(0, Math.min(3, facialFrames.length));
          
          for (const facialFrame of topFacialFrames) {
            const position = facialFrame.position;
            
            // Try to capture a frame slightly before and after this face-rich frame
            const adjacentPositions = [
              Math.max(0, position - 0.5),
              Math.min(video.duration, position + 0.5)
            ];
            
            for (const adjPosition of adjacentPositions) {
              // Only add if not too close to existing captures
              const isTooClose = capturePositions.some(pos => Math.abs(pos - adjPosition) < 0.25);
              
              if (!isTooClose) {
                try {
                  console.log(`Capturing additional facial area frame at ${adjPosition.toFixed(2)}s`);
                  const result = await captureFrameAtTime(adjPosition);
                  
                  if (!result.skipped && !frameHashes.has(result.hash)) {
                    frames.push(result.frame);
                    capturePositions.push(adjPosition);
                    frameHashes.add(result.hash);
                  }
                } catch (e) {
                  console.error("Error capturing facial area frame:", e);
                }
              }
            }
          }
        }
      }
      
      // Restore video to original state
      try {
        video.currentTime = originalTime;
        if (wasPlaying) {
          video.play().catch(e => console.error("Error resuming playback:", e));
        }
      } catch (e) {
        console.error("Error restoring video state:", e);
      }
      
      console.log(`Capture complete: ${frames.length} frames (${facialFrames.length} with faces)`);
      
      // Check if we have enough frames for proper analysis
      // For deepfake detection, we typically need at least 10 frames to detect temporal inconsistencies
      const MIN_FRAMES_REQUIRED = 10;
      
      if (frames.length < MIN_FRAMES_REQUIRED) {
        console.log(`Insufficient frames captured (${frames.length}). Need at least ${MIN_FRAMES_REQUIRED} frames for proper analysis.`);
        return mainResolve({ 
          frames: [], 
          width: canvas.width, 
          height: canvas.height, 
          error: `Not enough frames captured (${frames.length}/${MIN_FRAMES_REQUIRED}) for reliable deepfake detection`,
          needsWebRTC: true
        });
      }
      
      // Return the captured frames
      return mainResolve({
        frames: frames,
        width: canvas.width,
        height: canvas.height,
        frameCount: frames.length,
        capturePositions: capturePositions,
        frameRate: frameRate,
        duration: video.duration || 0,
        facialFrameCount: facialFrames.length
      });
    } catch (error) {
      console.error("Frame capture error:", error);
      return mainResolve({ 
        frames: [], 
        width: 0, 
        height: 0, 
        error: error.toString(),
        stack: error.stack,
        needsWebRTC: true
      });
    }
  });
}

// Find the main video element on the page
function findMainVideoElement() {
  const videos = document.querySelectorAll('video');
  if (!videos || videos.length === 0) {
    return null;
  }
  
  // First try to find a playing video
  for (const video of videos) {
    if (!video.paused && video.currentTime > 0) {
      return video;
    }
  }
  
  // If no playing video, find the largest visible video
  let largestVideo = null;
  let largestSize = 0;
  
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 &&
                     rect.top < window.innerHeight && rect.bottom > 0 &&
                     rect.left < window.innerWidth && rect.right > 0;
    
    if (isVisible) {
      const size = rect.width * rect.height;
      if (size > largestSize) {
        largestSize = size;
        largestVideo = video;
      }
    }
  }
  
  return largestVideo;
}

// WebRTC Screen/Video Capture Implementation for hard-to-access platforms
function createCaptureOverlay(videoRect) {
  const overlay = document.createElement('div');
  overlay.className = 'df-helper-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: ${videoRect.top}px;
    left: ${videoRect.left}px;
    width: ${videoRect.width}px;
    height: ${videoRect.height}px;
    border: 3px solid #007aff;
    box-shadow: 0 0 0 3000px rgba(0, 0, 0, 0.5);
    z-index: 999998;
    pointer-events: none;
    box-sizing: border-box;
  `;
  
  // Add a label
  const label = document.createElement('div');
  label.className = 'df-helper-label';
  label.textContent = 'Position video in this area';
  label.style.cssText = `
    position: absolute;
    top: -30px;
    left: 50%;
    transform: translateX(-50%);
    background: #007aff;
    color: white;
    padding: 4px 10px;
    border-radius: 4px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 12px;
    white-space: nowrap;
  `;
  
  overlay.appendChild(label);
  document.body.appendChild(overlay);
  
  return overlay;
}

function showCaptureInstructions(overlay) {
  return new Promise((resolve) => {
    const instructions = document.createElement('div');
    instructions.className = 'df-capture-instructions';
    instructions.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 20px;
      max-width: 400px;
      text-align: center;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    `;
    
    instructions.innerHTML = `
      <div class="df-instructions-content">
        <h3 style="margin-top: 0; color: #333;">Position the video in your screen capture</h3>
        <p style="color: #555;">Make sure the blue rectangle is fully visible in your screen share.</p>
        <p style="color: #555;">This alternative capture method is needed for some video platforms.</p>
        <div style="margin-top: 20px;">
          <button class="df-continue-btn" style="background: #007aff; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin-right: 10px; cursor: pointer;">Continue Capture</button>
          <button class="df-cancel-btn" style="background: #f1f1f1; color: #333; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(instructions);
    
    // Handle continue button click
    const continueBtn = instructions.querySelector('.df-continue-btn');
    continueBtn.addEventListener('click', () => {
      instructions.remove();
      resolve(true);
    });
    
    // Handle cancel button click
    const cancelBtn = instructions.querySelector('.df-cancel-btn');
    cancelBtn.addEventListener('click', () => {
      instructions.remove();
      overlay.remove();
      resolve(false);
    });
  });
}

// Helper to stop all media tracks
function stopAllTracks(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

// Helper function to monitor positioning quality for WebRTC capture
function monitorCapturePosition(videoElement, captureVideo, overlay) {
  // Create a feedback indicator
  const feedback = document.createElement('div');
  feedback.className = 'df-position-feedback';
  feedback.style.cssText = `
    position: absolute;
    bottom: -40px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    transition: background-color 0.3s;
  `;
  overlay.appendChild(feedback);

  // Variable to store the monitoring interval
  let monitoringInterval;

  // Start monitoring
  const startMonitoring = () => {
    monitoringInterval = setInterval(() => {
      try {
        // Get the video element position
        const videoRect = videoElement.getBoundingClientRect();
        
        // Get some sample points from the capture (simplified)
        if (captureVideo.videoWidth === 0) return;
        
        // Create a temporary canvas to analyze a frame from the capture
        const tempCanvas = document.createElement('canvas');
        const width = Math.min(captureVideo.videoWidth, 300);
        const height = Math.min(captureVideo.videoHeight, 200);
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');
        
        // Draw the current frame
        ctx.drawImage(captureVideo, 0, 0, width, height);
        
        // Calculate average brightness as a simple metric
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        let totalBrightness = 0;
        
        for (let i = 0; i < data.length; i += 20) { // Sample every 20th pixel for performance
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          totalBrightness += (r + g + b) / 3;
        }
        
        const avgBrightness = totalBrightness / (data.length / 20 / 4);
        
        // Simple quality assessment
        if (avgBrightness < 20) {
          // Too dark - might not be capturing video
          feedback.textContent = "Video not visible in capture";
          feedback.style.backgroundColor = "rgba(255, 0, 0, 0.7)";
        } else if (avgBrightness > 220) {
          // Too bright - might be capturing white space
          feedback.textContent = "Video may not be properly positioned";
          feedback.style.backgroundColor = "rgba(255, 165, 0, 0.7)";
        } else {
          // Probably good
          feedback.textContent = "Position looks good";
          feedback.style.backgroundColor = "rgba(0, 128, 0, 0.7)";
        }
      } catch (e) {
        console.error("Error monitoring capture quality:", e);
        feedback.textContent = "Unable to check position";
        feedback.style.backgroundColor = "rgba(128, 128, 128, 0.7)";
      }
    }, 500);
  };

  // Function to stop monitoring
  const stopMonitoring = () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
    }
    if (feedback && feedback.parentNode) {
      feedback.parentNode.removeChild(feedback);
    }
  };
  
  // Start monitoring immediately
  startMonitoring();
  
  // Return the stop function for cleanup
  return stopMonitoring;
}

              

// This function implements a combined approach that tries standard video capture
// first and falls back to WebRTC screen capture if needed
function captureVideoWithFallbacks() {
  console.log("Starting video capture with fallback methods...");
  
  return new Promise(async (mainResolve) => {
    try {
      // First, pre-check if standard capture is likely to work
      const precheck = await precheckStandardCapture();
      console.log("Pre-check results:", precheck);
      
      let captureResult = null;
      
      // Check for sites that are known to block standard capture
      const isBlockedSite = window.location.hostname.includes('threads.net') || 
                           window.location.hostname.includes('instagram.com');
      
      // If precheck says standard capture won't work OR it's a known blocked site,
      // skip standard capture and jump straight to WebRTC
      if (!precheck.canUseStandard || isBlockedSite) {
        console.log("Pre-check indicates standard capture won't work, proceeding directly to WebRTC fallback");
        // Skip to WebRTC fallback without showing standard capture notification
        proceedToWebRTC(null, precheck.videoElement);
        return;
      }
      
      // If we're here, standard capture should work - show UI and proceed
      console.log("Standard capture appears possible, proceeding...");
      
      // Show notification to user that capture is starting
      const notification = document.createElement('div');
      notification.className = 'df-capture-notification';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px 15px;
        border-radius: 4px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      `;
      notification.textContent = "Capturing video frames for analysis...";
      document.body.appendChild(notification);
      
      // Attempt standard capture
      captureResult = await captureVideoFrames();
      
      // Remove notification
      if (notification.parentNode) {
        notification.remove();
      }
      
      // Check if we got enough frames for proper analysis
      // The minimum required is now enforced in captureVideoFrames
      if (captureResult && captureResult.frames && captureResult.frames.length >= 10) {
        console.log(`Standard capture successful with ${captureResult.frames.length} frames`);
        return mainResolve(captureResult);
      }
      
      // If we're here, standard capture has failed to get enough frames
      // Check if we got an explicit signal that WebRTC is needed
      const needWebRTC = captureResult?.needsWebRTC || captureResult?.securityError || 
                        (captureResult?.error && (
                          captureResult.error.includes("security") || 
                          captureResult.error.includes("cross-origin")
                        ));
      
      if (needWebRTC || !captureResult || !captureResult.frames || captureResult.frames.length < 10) {
        // Move to WebRTC fallback
        proceedToWebRTC(captureResult, precheck.videoElement);
      } else {
        // This case should be rare - standard capture didn't explicitly fail but didn't trigger the success return
        // Return whatever results we got from standard capture
        console.log("Standard capture completed but didn't meet success criteria");
        return mainResolve(captureResult || {
          error: "Standard capture completed but didn't get enough frames for analysis",
          frames: []
        });
      }
      
      // Internal function to handle WebRTC fallback
      async function proceedToWebRTC(captureResult, videoElement) {
        // If we're here, standard capture failed or got too few frames - try WebRTC
        console.log("Trying WebRTC screen capture fallback...");
        
        // First find if there's a video on the page to guide the user
        if (!videoElement) {
          videoElement = findMainVideoElement();
        }
        
        if (!videoElement) {
          console.log("No video element found to guide WebRTC capture");
          // Still return what we got from standard capture, even if it's an error
          return mainResolve(captureResult || { 
            error: "No video element found for analysis", 
            frames: [] 
          });
        }
        
        // Get video dimensions and position
        const videoRect = videoElement.getBoundingClientRect();
        
        try {
          // Show a prompt explaining why we need screen capture
          const message = document.createElement('div');
          message.className = 'df-capture-message';
          message.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            padding: 20px;
            max-width: 450px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            text-align: center;
          `;
          
          // Create a more descriptive message based on the failure reason
          let reasonText = "This site restricts direct video access for security reasons.";
          if (captureResult && captureResult.error) {
            if (captureResult.error.includes("Not enough frames")) {
              reasonText = "We couldn't capture enough video frames for accurate analysis.";
            } else if (captureResult.error.includes("security") || captureResult.error.includes("cross-origin")) {
              reasonText = "This site's security restrictions prevent direct video access.";
            }
          }
          
          message.innerHTML = `
            <h3 style="margin-top: 0; color: #333;">Screen Capture Required</h3>
            <p style="color: #555;">${reasonText}</p>
            <p style="color: #555;">We'll need to use screen capture to analyze this video.</p>
            <div style="margin-top: 20px;">
              <button class="df-continue-btn" style="background: #007aff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Continue with Screen Capture</button>
              <button class="df-cancel-btn" style="background: transparent; color: #666; border: none; padding: 10px; margin-left: 10px; cursor: pointer;">Cancel</button>
            </div>
          `;
          
          document.body.appendChild(message);
          
          // Wait for user decision
          const userDecision = await new Promise(resolve => {
            const continueBtn = message.querySelector('.df-continue-btn');
            const cancelBtn = message.querySelector('.df-cancel-btn');
            
            continueBtn.addEventListener('click', () => {
              message.remove();
              resolve(true);
            });
            
            cancelBtn.addEventListener('click', () => {
              message.remove();
              resolve(false);
            });
          });
          
          if (!userDecision) {
            return mainResolve(captureResult || {
              error: "WebRTC capture cancelled by user",
              frames: []
            });
          }
          
          // Ask the user to share their screen
          const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              cursor: "never",
              displaySurface: "browser"
            },
            audio: false
          });
          
          // Create a video element for the screen capture
          const captureVideo = document.createElement('video');
          captureVideo.srcObject = screenStream;
          captureVideo.muted = true;
          
          // Show guidance overlay
          const overlay = createCaptureOverlay(videoRect);
          
          // Wait for video to be ready
          await new Promise(resolve => {
            captureVideo.onloadedmetadata = () => {
              captureVideo.play().then(resolve).catch(e => {
                console.error("Error playing capture video:", e);
                resolve(); // Still resolve to continue the flow
              });
            };
          });
          
          // Start position quality monitoring
          const stopMonitoring = monitorCapturePosition(videoElement, captureVideo, overlay);
          
          // Wait for user confirmation
          const shouldProceed = await showCaptureInstructions(overlay);
          
          // Stop monitoring
          stopMonitoring();
          
          if (!shouldProceed) {
            stopAllTracks(screenStream);
            overlay.remove();
            return mainResolve(captureResult || { 
              error: "WebRTC capture cancelled by user",
              frames: []
            });
          }
          
          // Capture frames from the screen capture
          const canvas = document.createElement('canvas');
          canvas.width = captureVideo.videoWidth;
          canvas.height = captureVideo.videoHeight;
          const ctx = canvas.getContext('2d');
          
          // Ensure we capture enough frames for analysis (minimum 10, ideally 15-20)
          // Use duration to estimate a good number of frames
          const videoLength = videoElement.duration || 30; // Default to 30s if duration unknown
          const frameCount = Math.min(25, Math.max(15, Math.ceil(videoLength / 2))); // At least 15, at most 25 frames
          
          const webrtcFrames = [];
          
          // Add capture feedback
          const capturingIndicator = document.createElement('div');
          capturingIndicator.className = 'df-capturing-indicator';
          capturingIndicator.textContent = 'Capturing frames...';
          capturingIndicator.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          `;
          document.body.appendChild(capturingIndicator);
          
          // Capture frames with delay
          for (let i = 0; i < frameCount; i++) {
            try {
              // Update progress
              capturingIndicator.textContent = `Capturing frames... ${i+1}/${frameCount}`;
              
              // Draw the current frame to canvas
              ctx.drawImage(captureVideo, 0, 0);
              
              // Convert to data URL
              const frameDataUrl = canvas.toDataURL('image/jpeg', 0.85);
              webrtcFrames.push(frameDataUrl);
              
              // Wait a bit before capturing next frame
              await new Promise(r => setTimeout(r, 200));
            } catch (e) {
              console.error("Error capturing WebRTC frame:", e);
            }
          }
          
          // Cleanup
          stopAllTracks(screenStream);
          overlay.remove();
          capturingIndicator.remove();
          
          console.log(`WebRTC capture complete with ${webrtcFrames.length} frames`);
          
          // Ensure we have enough frames for analysis
          if (webrtcFrames.length < 10) {
            console.error("WebRTC capture failed to get enough frames for analysis");
            return mainResolve({ 
              error: "WebRTC capture could not collect enough frames for reliable analysis",
              frames: webrtcFrames  // Include the frames anyway in case they want to try
            });
          }
          
          // Return WebRTC capture results
          return mainResolve({
            frames: webrtcFrames,
            width: canvas.width,
            height: canvas.height,
            frameCount: webrtcFrames.length,
            capturePositions: Array(webrtcFrames.length).fill(0).map((_, i) => i * (videoElement.duration || 30) / webrtcFrames.length),
            duration: videoElement.duration || 0,
            method: "webrtc",
            isFallback: true
          });
        } catch (error) {
          console.error("WebRTC capture error:", error);
          // Return the original capture result, even if it failed
          return mainResolve(captureResult || { 
            error: "WebRTC capture failed: " + error.toString(),
            frames: []
          });
        }
      }
    } catch (error) {
      console.error("Combined capture error:", error);
      return mainResolve({ 
        error: error.toString(),
        frames: [] 
      });
    }
  });
}