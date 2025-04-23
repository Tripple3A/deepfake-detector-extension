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
          error: "No video found on page" 
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
          error: "No suitable video found" 
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
      targetFrameCount = Math.max(20, Math.min(targetFrameCount, 600));
      
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

      // Function to capture a frame at a specific time
     // Enhanced frame capture function with better error handling
// This should be placed inside your captureVideoFrames function
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
                error: dataUrlError.toString()
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
              error: drawError.toString()
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
          error: seekError.toString()
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
      const initialFrameCount = Math.min(targetFrameCount, 100); // Start with a reasonable number
      
      console.log(`First pass: Capturing ${initialFrameCount} evenly distributed frames`);
      
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
            continue;
          }
          
          capturePositions.push(timePosition);
          
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
      
      // Second-pass: Focus on key moments and face detection
      const keyPositions = [
        0.1, // Near start
        video.duration * 0.25, // First quarter
        video.duration * 0.5,  // Middle
        video.duration * 0.75, // Third quarter
        Math.max(0, video.duration - 0.5) // Near end
      ];
      
      // Add any scene change points based on content analysis
      // This is a simplified approach - we look for frames with significant differences
      if (frames.length >= 3) {
        console.log("Looking for potential scene changes...");
        const sceneChangePoints = [];
        
        // Skip the first and last frames in the analysis
        for (let i = 1; i < capturePositions.length - 1; i++) {
          try {
            const prevPos = capturePositions[i-1];
            const currPos = capturePositions[i];
            const nextPos = capturePositions[i+1];
            
            // Look for irregular spacing that might indicate scene changes
            const prevDiff = currPos - prevPos;
            const nextDiff = nextPos - currPos;
            
            // If there's a significant change in frame spacing, mark as potential scene change
            if (Math.abs(nextDiff - prevDiff) > 0.5) {
              // Add points before and after the potential scene change
              const beforeChange = currPos - (prevDiff * 0.25);
              const afterChange = currPos + (nextDiff * 0.25);
              
              if (beforeChange > 0) sceneChangePoints.push(beforeChange);
              if (afterChange < video.duration) sceneChangePoints.push(afterChange);
              
              console.log(`Potential scene change detected around ${currPos.toFixed(2)}s`);
            }
          } catch (e) {
            console.error("Error detecting scene changes:", e);
          }
        }
        
        // Add scene change points to key positions
        keyPositions.push(...sceneChangePoints);
      }
      
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
      
      // If face detection is supported, prioritize facial frames and capture more
      if (faceDetectionSupported && facialFrames.length > 0) {
        console.log(`Face detection found ${facialFrames.length} frames with faces`);
        
        // Sort by face count (descending)
        facialFrames.sort((a, b) => b.faceCount - a.faceCount);
        
        // Calculate temporal clusters of faces to find talking segments
        if (facialFrames.length >= 2) {
          const facialClusters = [];
          let currentCluster = [facialFrames[0].position];
          
          for (let i = 1; i < facialFrames.length; i++) {
            const prevPos = facialFrames[i-1].position;
            const currPos = facialFrames[i].position;
            
            if (currPos - prevPos < 3.0) {
              // Part of the same cluster
              currentCluster.push(currPos);
            } else {
              // Start a new cluster
              facialClusters.push([...currentCluster]);
              currentCluster = [currPos];
            }
          }
          
          // Add the last cluster
          if (currentCluster.length > 0) {
            facialClusters.push([...currentCluster]);
          }
          
          console.log(`Identified ${facialClusters.length} clusters of facial activity`);
          
          // Sample more frames from the facial clusters
          for (const cluster of facialClusters) {
            if (cluster.length < 2) continue;
            
            const startTime = Math.min(...cluster);
            const endTime = Math.max(...cluster);
            const duration = endTime - startTime;
            
            if (duration < 0.5) continue;
            
            // Sample additional frames within this cluster
            const additionalFrames = Math.min(Math.ceil(duration * 3), 10);
            
            for (let i = 0; i < additionalFrames; i++) {
              try {
                const position = startTime + (duration * (i / additionalFrames));
                
                // Check if too close to existing frames
                const isTooClose = capturePositions.some(pos => Math.abs(pos - position) < 0.15);
                
                if (!isTooClose) {
                  console.log(`Capturing additional facial cluster frame at ${position.toFixed(2)}s`);
                  const result = await captureFrameAtTime(position);
                  
                  if (!result.skipped && !frameHashes.has(result.hash)) {
                    frames.push(result.frame);
                    capturePositions.push(position);
                    frameHashes.add(result.hash);
                  }
                }
              } catch (e) {
                console.error("Error capturing facial cluster frame:", e);
              }
            }
          }
        }
      }
      
      // Handle short videos - duplicate frames if needed to reach minimum threshold
      if (frames.length < 20 && totalFramesInVideo > 0) {
        console.log(`Short video detected with only ${frames.length} frames captured. Adding duplicates to ensure minimum frame count.`);
        
        // Add duplicates prioritizing unique content
        const minFrames = Math.min(20, totalFramesInVideo);
        const framesCopy = [...frames];
        
        while (frames.length < minFrames && framesCopy.length > 0) {
          // Add frames from our copy (will create duplicates)
          frames.push(framesCopy[frames.length % framesCopy.length]);
        }
        
        console.log(`Added duplicates to reach ${frames.length} total frames`);
      }
      
      // Restore video to original state
      try {
        video.currentTime = originalTime;
        if (wasPlaying) {
          video.play();
        }
      } catch (e) {
        console.error("Error restoring video state:", e);
      }
      
      console.log(`Successfully captured ${frames.length} frames (${facialFrames.length} with faces)`);
      
     // And replace it with:
if (frames.length === 0) {
  // If we couldn't capture any frames, just return the error
  return mainResolve({ 
    frames: [], 
    width: canvas.width, 
    height: canvas.height, 
    error: "Failed to capture any frames from video",
    securityError: true,  // Add this flag to indicate security issues
    needsWebRTC: true     // Add this flag to explicitly indicate WebRTC is needed
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
        stack: error.stack 
      });
    }
  });
}

function requestTabCaptureFallback() {
  console.log("Site blocks screen capture APIs, requesting tab capture fallback...");
  
  try {
    // Send a message to the background script to initiate tabCapture
    chrome.runtime.sendMessage({ 
      action: "needTabCapture",
      reason: "display-capture-blocked",
      url: window.location.href
    });
    
    // Return an empty result to signal the need for tabCapture
    return {
      frames: [],
      error: "This site blocks screen capture. Using tab capture instead.",
      displayCaptureBlocked: true
    };
  } catch (e) {
    console.error("Error requesting tabCapture:", e);
    return {
      frames: [],
      error: "Failed to request tab capture: " + e.message
    };
  }
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
    instructions.innerHTML = `
      <div class="df-instructions-content">
        <h3>Position the video in your screen capture</h3>
        <p>Make sure the blue rectangle is fully visible in your screen share.</p>
        <p>This alternative capture method is needed for some video platforms.</p>
        <button class="df-continue-btn">Continue Capture</button>
        <button class="df-cancel-btn">Cancel</button>
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

// This function implements a combined approach that tries standard video capture
// first and falls back to WebRTC screen capture if needed
// This function implements a combined approach that tries standard video capture
// first and falls back to WebRTC screen capture if needed
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
      
      if (precheck.canUseStandard) {
        // Standard capture should work - show UI and proceed
        console.log("Standard capture appears possible, proceeding...");
        
        // Show notification to user that capture is starting
        const notification = document.createElement('div');
        notification.className = 'df-capture-notification';
        notification.innerHTML = `
          <div style="
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
          ">
            Capturing video frames for analysis...
          </div>
        `;
        document.body.appendChild(notification);
        
        // Attempt standard capture
        captureResult = await captureVideoFrames();
        
        // Remove notification
        if (notification.parentNode) {
          notification.remove();
        }
        
        // Check if we got enough frames
        if (captureResult && captureResult.frames && captureResult.frames.length >= 5) {
          console.log(`Standard capture successful with ${captureResult.frames.length} frames`);
          return mainResolve(captureResult);
        }
      }

      const isBlockedSite = window.location.hostname.includes('threads.net');

      if (isBlockedSite) {
        console.log("Detected threads.net - this site blocks screen capture");
        return mainResolve(requestTabCaptureFallback());
      }
        
        // If we're here, standard capture failed or got too few frames - try WebRTC
        console.log("Trying WebRTC screen capture fallback...");
        
        // First find if there's a video on the page to guide the user
        const videoElement = findMainVideoElement();
        if (!videoElement) {
          console.log("No video element found to guide WebRTC capture");
          // Still return what we got from standard capture, even if it's an error
          return mainResolve(captureResult);
        }
        
        // Get video dimensions and position
        const videoRect = videoElement.getBoundingClientRect();
        
        try {
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
            return mainResolve({ 
              error: "WebRTC capture cancelled by user",
              frames: captureResult?.frames || []
            });
          }
          
          // Capture frames from the screen capture
          const canvas = document.createElement('canvas');
          canvas.width = captureVideo.videoWidth;
          canvas.height = captureVideo.videoHeight;
          const ctx = canvas.getContext('2d');
          
          const webrtcFrames = [];
          const frameCount = Math.min(20, Math.max(10, Math.ceil(videoElement.duration / 2)));
          
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
          
          console.log(`WebRTC capture successful with ${webrtcFrames.length} frames`);
          
          // Return combined results
          return mainResolve({
            frames: webrtcFrames,
            width: canvas.width,
            height: canvas.height,
            frameCount: webrtcFrames.length,
            capturePositions: Array(webrtcFrames.length).fill(0), // We don't know precise positions
            duration: videoElement.duration || 0,
            method: "webrtc",
            isFallback: true
          });
        } catch (error) {
          console.error("WebRTC capture error:", error);
          // Return the original capture result, even if it failed
          return mainResolve(captureResult || { 
            error: "Both standard and WebRTC captures failed",
            frames: []
          });
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