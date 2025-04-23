// DeepFake Detector Background Script

// API endpoint
const API_URL = 'https://deepfake-detector-106176227689.us-central1.run.app';

// Keep track of analysis history
let analysisHistory = [];


// Separate function to register context menus
// Separate function to register context menus
// This ensures we're only using the ID that actually gets created
function registerContextMenus() {
  // First remove any existing menus to prevent duplicates
  chrome.contextMenus.removeAll(() => {
    console.log("Cleared existing context menus");
    
    // Create a single context menu item that appears for videos and pages
    chrome.contextMenus.create({
      id: "analyze-media",
      title: "Check for Deepfake",
      contexts: ["video", "page"] // This will show on both videos and pages
    }, function() {
      if (chrome.runtime.lastError) {
        console.error("Error creating menu:", chrome.runtime.lastError.message);
      } else {
        console.log("Deepfake detection menu created successfully");
      }
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    // First validate the tab ID
    if (!tabId) {
      console.warn("Cannot send message - no valid tab ID provided");
      return reject(new Error("No valid tab ID"));
    }
    
    // Check if the tab exists first
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.warn(`Tab ${tabId} doesn't exist:`, chrome.runtime.lastError.message);
        return reject(new Error(`Tab ${tabId} doesn't exist`));
      }
      
      // Now try to send the message
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) {
          // This could be because content script isn't loaded yet
          console.log(`Message failed, will try injecting content script first: ${chrome.runtime.lastError.message}`);
          
          // Try to inject the content script and then retry sending the message
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          }).then(() => {
            // Give the content script a moment to initialize
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, message, secondResponse => {
                if (chrome.runtime.lastError) {
                  console.error(`Failed even after injecting content script: ${chrome.runtime.lastError.message}`);
                  reject(chrome.runtime.lastError);
                } else {
                  resolve(secondResponse);
                }
              });
            }, 500);
          }).catch(err => {
            console.error("Failed to inject content script:", err);
            reject(err);
          });
        } else {
          // Message sent successfully
          resolve(response);
        }
      });
    });
  });
}



// Register context menus when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("DeepFake Detector extension installed");
  
  // Register context menus
  registerContextMenus();
  
  // Load analysis history
  chrome.storage.local.get(['analysisHistory'], (result) => {
    if (result.analysisHistory) {
      analysisHistory = result.analysisHistory;
    } else {
      chrome.storage.local.set({analysisHistory: []});
    }
  });
});



// Register context menus when browser starts
chrome.runtime.onStartup.addListener(() => {
  console.log("Browser started - reinstalling context menus");
  registerContextMenus();
});

// Add this to handle the keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  console.log("Command received:", command);
  if (command === "analyze-current-video") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0) {
        console.log("Keyboard shortcut: analyzing video in current tab");
        analyzeCurrentVideo(tabs[0].id);
      }
    });
  }
});

// background.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "needTabCapture" && sender.tab?.id) {
    tabCaptureFallback(sender.tab.id);
  }
});

// Add more specific handler for tabCapture requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "needTabCapture") {
    console.log("Tab capture requested:", msg.reason || "unknown reason");
    
    // Make sure we have a valid tab ID
    if (sender && sender.tab && sender.tab.id) {
      // Start the tabCapture process
      tabCaptureFallback(sender.tab.id);
      sendResponse({ success: true });
    } else {
      console.error("Tab capture requested but no valid tab ID found");
      sendResponse({ success: false, error: "No valid tab ID" });
    }
    return true;  // Keep the message channel open for async response
  }
});

// Replace your current notifyUser function with this one
function notifyUser(tabId, type, message) {
  if (!tabId) {
    console.warn("Cannot notify - no valid tab ID");
    return;
  }
  
  sendMessageToTab(tabId, { action: "showNotification", type, message })
    .catch(error => {
      console.warn(`Notification to tab ${tabId} failed: ${error.message}`);
      // We've already tried our best to handle this in sendMessageToTab
    });
}


// Handle context menu clicks - FIXED VERSION
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log("Menu clicked:", info.menuItemId); // Add logging for debugging
  
  // Make sure tab exists before trying to access tab.id
  if (!tab) {
    console.error("Tab is undefined in onClicked handler");
    return;
  }
  
  // Simplified menu handler - just check for the menu ID we actually use
  if (info.menuItemId === "analyze-media") {
    console.log("Analyzing media in tab:", tab.id);
    analyzeCurrentVideo(tab.id);
  }
});


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
        console.log("Video duration unavailable, using current frame only");
        return mainResolve(captureCurrentFrameOnly(video));
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
      const ctx = canvas.getContext('2d');
      
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
              
              // Draw frame to canvas
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              // Generate a simple frame hash to check for duplicates
              const pixelData = ctx.getImageData(0, 0, 20, 20).data; // Small sample for speed
              let hash = 0;
              for (let i = 0; i < pixelData.length; i += 20) {
                hash = ((hash << 5) - hash) + pixelData[i];
                hash = hash & hash; // Convert to 32bit integer
              }
              
              // Calculate capture quality based on resolution
              const videoSize = canvas.width * canvas.height;
              const jpegQuality = videoSize > 1280 * 720 ? 0.7 : 0.85;
              
              const frameDataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
              
              resolve({
                frame: frameDataUrl,
                position: timePosition,
                hash: hash
              });
            } catch (e) {
              console.error("Error in frame capture:", e);
              reject(e);
            }
          };
          
          // Set up event listener for seeking completion
          video.addEventListener('seeked', seekHandler);
          
          // Start seeking
          video.currentTime = timePosition;
          
          // Set a timeout in case seeking never completes
          setTimeout(() => {
            video.removeEventListener('seeked', seekHandler);
            reject(new Error(`Seek timeout at position ${timePosition.toFixed(2)}s`));
          }, 500);
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
      
      if (frames.length === 0) {
        // Fallback: try to capture at least the current frame
        const fallback = captureCurrentFrameOnly(video);
        return mainResolve(fallback);
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
      // First, try the standard video element capture
      console.log("Attempting standard video element capture first...");
      let captureResult = await captureVideoFrames();
      
      // If standard capture succeeded with enough frames, use that result
      if (captureResult && captureResult.frames && captureResult.frames.length >= 5) {
        console.log(`Standard capture successful with ${captureResult.frames.length} frames`);
        return mainResolve(captureResult);
      }
      
      // If we're here, standard capture failed or got too few frames - try WebRTC
      console.log("Standard capture failed or insufficient. Trying WebRTC screen capture...");
      
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
            captureVideo.play().then(resolve);
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


//
// 1A) Last‑ditch: record 2s of the whole tab, then hand the WebM over for frame‑extraction
function tabCaptureFallback(tabId) {
  console.log(`Starting tab capture fallback for tab ${tabId}...`);
  
  // First, check if we can verify the tab exists
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error("Tab does not exist:", chrome.runtime.lastError);
      return;
    }
    
    // First, let's explicitly inject the content script before trying to notify
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js'] // Note: not content-capture.js
    }).then(() => {
      // At this point we know the content script is injected, but it still might not be ready
      // to receive messages, so we'll add a small delay
      setTimeout(() => {
        // Instead of using notifyUser directly, let's create a simpler function just for this case
        chrome.tabs.sendMessage(tabId, {
          action: "showNotification",
          type: "progress",
          message: "Standard & WebRTC both failed — trying full‑tab capture…"
        }, (response) => {
          // Ignore any response errors and continue with capture regardless
          
          // Now proceed with tabCapture
          chrome.tabCapture.capture({ 
            audio: false, 
            video: true 
          }, stream => {
            if (!stream) {
              console.error("Tab capture failed - no stream");
              try {
                chrome.tabs.sendMessage(tabId, {
                  action: "showNotification",
                  type: "error",
                  message: "Tab capture failed – no frames captured."
                });
              } catch (e) {
                console.error("Failed to send error notification:", e);
              }
              return;
            }
            
            // Continue with your existing code...
            try {
              const recorder = new MediaRecorder(stream, { 
                mimeType: "video/webm; codecs=vp9"
              });
              
              const chunks = [];
              recorder.ondataavailable = e => chunks.push(e.data);
              
              // When recording stops, process the video
              recorder.onstop = async () => {
                // Your existing code...
                try {
                  const blob = new Blob(chunks, { type: "video/webm" });
                  const arrayBuffer = await blob.arrayBuffer();
                  
                  // Stop all tracks
                  stream.getTracks().forEach(t => t.stop());
                  
                  // Process the blob without trying to show notifications first
                  analyzeBlob(tabId, arrayBuffer);
                } catch (error) {
                  console.error("Error processing recording:", error);
                  stream.getTracks().forEach(t => t.stop());
                }
              };
              
              // Start recording
              recorder.start();
              
              // Stop after 2 seconds
              setTimeout(() => {
                if (recorder.state === "recording") {
                  recorder.stop();
                }
              }, 2000);
            } catch (error) {
              console.error("MediaRecorder setup error:", error);
              stream.getTracks().forEach(t => t.stop());
            }
          });
        });
      }, 200); // Short delay to ensure content script is ready
    }).catch(err => {
      console.error("Failed to inject content script for notifications:", err);
      
      // Continue with tabCapture anyway, but don't try to notify
      chrome.tabCapture.capture({ 
        audio: false, 
        video: true 
      }, stream => {
        if (!stream) {
          console.error("Tab capture failed - no stream (fallback without notification)");
          return;
        }
        
        try {
          const recorder = new MediaRecorder(stream, { 
            mimeType: "video/webm; codecs=vp9"
          });
          
          const chunks = [];
          recorder.ondataavailable = e => chunks.push(e.data);
          
          recorder.onstop = async () => {
            try {
              const blob = new Blob(chunks, { type: "video/webm" });
              const arrayBuffer = await blob.arrayBuffer();
              stream.getTracks().forEach(t => t.stop());
              analyzeBlob(tabId, arrayBuffer);
            } catch (error) {
              console.error("Error processing recording:", error);
              stream.getTracks().forEach(t => t.stop());
            }
          };
          
          recorder.start();
          setTimeout(() => {
            if (recorder.state === "recording") {
              recorder.stop();
            }
          }, 2000);
        } catch (error) {
          console.error("MediaRecorder setup error in fallback:", error);
          stream.getTracks().forEach(t => t.stop());
        }
      });
    });
  });
}


//
// 1B) Take that WebM ArrayBuffer → extract ~20 frames in‑page → call analyzeFrames
//

function analyzeBlob(tabId, arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'video/webm' });
  const blobUrl = URL.createObjectURL(blob);

  // Inject script to extract frames from the blob
  chrome.scripting.executeScript({
    target: { tabId },
    func: (blobUrl) => {
      return new Promise((resolve, reject) => {
        try {
          const video = document.createElement('video');
          video.src = blobUrl;
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.playsInline = true;
          
          // Handle errors loading the video
          video.onerror = (e) => {
            reject(`Error loading video: ${video.error?.message || 'Unknown error'}`);
          };

          // When metadata is loaded, we can start extracting frames
          video.addEventListener('loadedmetadata', async () => {
            try {
              console.log(`Blob video dimensions: ${video.videoWidth}x${video.videoHeight}, duration: ${video.duration}s`);
              
              // Create a canvas for frame extraction
              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              
              if (!ctx) {
                throw new Error("Could not get canvas context");
              }

              // Prepare to capture frames
              const frames = [];
              let frameCount = Math.min(30, Math.max(20, Math.ceil(video.duration * 10)));
              
              // Play the video so we can seek through it
              await video.play().catch(e => console.error("Error playing video:", e));
              
              // Extract frames evenly throughout the video
              for (let i = 0; i < frameCount; i++) {
                try {
                  // Calculate position for this frame
                  const position = i / (frameCount - 1) * video.duration;
                  
                  // Seek to the position
                  video.currentTime = position;
                  
                  // Wait for seeking to complete
                  await new Promise(r => {
                    const seekHandler = () => {
                      video.removeEventListener('seeked', seekHandler);
                      r();
                    };
                    video.addEventListener('seeked', seekHandler, { once: true });
                    
                    // Add a timeout in case seeking gets stuck
                    setTimeout(() => {
                      video.removeEventListener('seeked', seekHandler);
                      console.warn(`Seek timeout at position ${position}s`);
                      r();
                    }, 500);
                  });
                  
                  // Draw the frame to canvas
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  
                  // Add the frame to our collection
                  try {
                    const quality = 0.8; // Good quality but smaller file size
                    frames.push(canvas.toDataURL('image/jpeg', quality));
                  } catch (err) {
                    console.error("Error converting frame to dataURL:", err);
                  }
                } catch (frameError) {
                  console.error(`Error capturing frame ${i}:`, frameError);
                }
              }
              
              // Return the frames and metadata
              resolve({
                frames,
                width: canvas.width,
                height: canvas.height,
                duration: video.duration,
                framesExtracted: frames.length
              });
              
              // Clean up
              video.pause();
              URL.revokeObjectURL(blobUrl);
            } catch (error) {
              reject(`Error extracting frames: ${error.message}`);
            }
          });
          
          // Load the video to trigger loadedmetadata
          video.load();
          
          // Set a timeout in case the video never loads
          setTimeout(() => {
            reject('Timeout loading video blob');
          }, 10000);
        } catch (error) {
          reject(`Error in blob analysis: ${error.message}`);
        }
      });
    },
    args: [blobUrl]
  }).then(injectionResults => {
    // Clean up the blob URL
    URL.revokeObjectURL(blobUrl);
    
    if (!injectionResults || !injectionResults[0] || !injectionResults[0].result) {
      return notifyUser(tabId, "error", "Failed to extract frames from tab capture");
    }

    const { frames, width, height, duration, framesExtracted } = injectionResults[0].result;
    
    // Validate results
    if (!frames || frames.length === 0) {
      return notifyUser(tabId, "error", "No frames could be extracted from tab capture");
    }
    
    console.log(`TabCapture extracted ${frames.length} frames from ${duration.toFixed(2)}s video`);
    
    // Prepare metadata for analysis
    const metadata = {
      width,
      height,
      duration,
      timestamp: Date.now(),
      randomId: Math.random().toString(36).slice(2),
      url: '',  // Will be filled in by the analyzeFrames function
      platform: 'tabCapture',
      frameRate: frames.length / duration,
      capturePositions: Array(frames.length).fill(0).map((_, i) => i * duration / frames.length),
      frameCount: frames.length,
      method: "tabCapture"
    };

    notifyUser(tabId, "progress", `Successfully captured ${frames.length} frames via tab capture`);
    
    // Get the tab's URL for reference
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.url) {
        metadata.url = tab.url;
        metadata.platform = detectPlatformFromUrl(tab.url);
      }
      
      // Send frames for analysis
      analyzeFrames(tabId, frames, metadata);
    });
  }).catch(error => {
    console.error("Error in tab capture script execution:", error);
    notifyUser(tabId, "error", `Tab capture analysis failed: ${error.message || error}`);
    URL.revokeObjectURL(blobUrl);
  });
}

// Helper function to process video frames after successful capture
function processVideoFrames(tabId, captureData) {
  // Get tab URL for storing in history
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error("Error getting tab info:", chrome.runtime.lastError);
      notifyUser(tabId, "error", "Failed to get video information");
      return;
    }
    
    const videoDetails = {
      width: captureData.width,
      height: captureData.height,
      timestamp: Date.now(),
      randomId: Math.random().toString(36).substring(2, 15),
      url: tab.url,
      platform: detectPlatformFromUrl(tab.url),
      frameRate: captureData.frameRate || 30,
      duration: captureData.duration || 0,
      capturePositions: captureData.capturePositions || [],
      frameCount: captureData.frames.length,
      method: captureData.method || "standard"
    };
    
    // Create appropriate message based on capture method
    let frameCountMessage;
    if (captureData.method === "webrtc") {
      frameCountMessage = `Captured ${captureData.frames.length} frames using screen capture (WebRTC fallback mode)`;
    } else if (captureData.isFallback) {
      frameCountMessage = `Sending ${captureData.frames.length} frame from current position (fallback mode)`;
    } else {
      frameCountMessage = `Sending ${captureData.frames.length} diverse frames from throughout the ${videoDetails.duration.toFixed(1)}s video`;
    }
    
    console.log(frameCountMessage);
    notifyUser(tabId, "progress", frameCountMessage);
    
    // Send frames to API for analysis
    analyzeFrames(tabId, captureData.frames, videoDetails);
  });
}


// Important improvements for message handlers
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "needTabCapture") {
    console.log("Tab capture requested:", msg.reason || "unknown reason");
    
    // Make sure we have a valid tab ID
    let tabId = null;
    if (msg.tabId) {
      tabId = msg.tabId;
    } else if (sender?.tab?.id) {
      tabId = sender.tab.id;
    } else {
      console.error("Tab capture requested but no valid tab ID found");
      sendResponse({ success: false, error: "No valid tab ID" });
      return true; // Keep message channel open
    }
    
    // Start the tabCapture process
    tabCaptureFallback(tabId);
    sendResponse({ success: true });
    return true;  // Keep the message channel open for async response
  }
  
  // Make sure to return true for other async message handlers
  if (msg.action === "analyzeCurrentVideo" || 
      msg.action === "analyzeUrl" || 
      msg.action === "getHistory" || 
      msg.action === "clearHistory") {
    // Return true to indicate we'll respond asynchronously
    return true;
  }
});


// Analyze current video with WebRTC fallback support
// Modify the analyzeCurrentVideo function to use the improved messaging
function analyzeCurrentVideo(tabId) {
  console.log(`Analyzing video in tab ${tabId}`);
  
  // Make sure we have a valid tab ID
  if (!tabId) {
    console.error("No valid tab ID for video analysis");
    return;
  }
  
  // Show initial notification with better error handling
  sendMessageToTab(tabId, { 
    action: "showNotification", 
    type: "start", 
    message: "Capturing video frames for analysis..." 
  }).catch(error => {
    console.warn("Could not send initial notification, continuing anyway");
  }).finally(() => {
    // Continue with analysis regardless of notification success
    
    // Inject the capture script with proper error handling
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content-capture.js'],
    })
    .then(() => {
      return chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Call the injected function
          return window.captureVideoWithFallbacks?.() || { 
            error: "Capture function not available", 
            frames: [] 
          };
        }
      });
    })
    .then(results => {
      if (!results || !results[0] || !results[0].result) {
        console.error("No capture results received");
        // Try tab capture
        chrome.runtime.sendMessage({ action: "needTabCapture", tabId: tabId });
        return;
      }
      
      const captureData = results[0].result;
      
      if (captureData.error && (!captureData.frames || captureData.frames.length === 0)) {
        console.error("Capture error:", captureData.error);
        chrome.runtime.sendMessage({ action: "needTabCapture", tabId: tabId });
        return;
      }
      
      if (!captureData.frames || captureData.frames.length === 0) {
        console.error("No frames captured");
        chrome.runtime.sendMessage({ action: "needTabCapture", tabId: tabId });
        return;
      }
      
      // Process successful capture results
      processVideoFrames(tabId, captureData);
    })
    .catch(error => {
      console.error("Script execution error:", error);
      // Try fallback
      chrome.runtime.sendMessage({ action: "needTabCapture", tabId: tabId });
    });
  });
}


// Send frames to API for analysis - fixed version
// Optimized hybrid function to send frames with conditional batch processing
function analyzeFrames(tabId, frames, metadata) {
  // Generate request ID
  const requestId = metadata.randomId;

  
  // Start measuring time
  const startTime = performance.now();
  
  // Show a notification about frame count
  notifyUser(tabId, "progress", `Processing ${frames.length} video frames...`);
  
  // Check if we have enough frames for a good analysis
  if (frames.length < 10) {
    console.warn(`Only ${frames.length} frames captured - analysis may be less accurate`);
    notifyUser(tabId, "progress", `Note: Limited frames (${frames.length}) may affect accuracy`);
  } else {
    console.log(`Good frame count: ${frames.length} frames for analysis`);
  }
  
  // ===== HYBRID APPROACH: THRESHOLD-BASED BATCH PROCESSING =====
  // Configure batch processing parameters
  const BATCH_THRESHOLD = 100; // Only use batches for videos with more than this many frames
  const MAX_FRAMES_PER_BATCH = 200; // Maximum frames per batch (increased from original)
  
  // Decide whether to use batch processing based on frame count
  const useBatchProcessing = frames.length > BATCH_THRESHOLD;
  
  console.log(`Using ${useBatchProcessing ? 'batch' : 'single-request'} processing mode for ${frames.length} frames`);
  
  // Prepare base metadata for API
  const baseRequestData = {
    id: requestId,
    timestamp: metadata.timestamp,
    dimensions: `${metadata.width}x${metadata.height}`,
    frameCount: frames.length,
    source: metadata.platform || 'unknown',
    version: '1.2', // Track extension version for API compatibility
    facial_data: metadata.facialFrameCount !== undefined ? metadata.facialFrameCount : 0
  };
  
  // If not using batch processing, send all frames at once (original behavior)
  if (!useBatchProcessing) {
    sendFrameBatch(frames, baseRequestData, tabId, 1, 1);
    return;
  }
  
  // For batch processing mode, determine optimal batch size
  const batchSize = Math.min(MAX_FRAMES_PER_BATCH, Math.ceil(frames.length / 3));
  const numBatches = Math.ceil(frames.length / batchSize);
  
  console.log(`Batch processing: Sending ${frames.length} frames in ${numBatches} batches (batch size: ${batchSize})`);
  
  // Initialize batch tracking
  let currentBatch = 1;
  let processedResults = [];
  
  // Function to send the next batch
  const processNextBatch = () => {
    if (currentBatch > numBatches) {
      // All batches processed, combine results
      combineResults(processedResults, tabId, metadata);
      return;
    }
    
    const start = (currentBatch - 1) * batchSize;
    const end = Math.min(start + batchSize, frames.length);
    const batchFrames = frames.slice(start, end);
    
    notifyUser(tabId, "progress", `Processing batch ${currentBatch}/${numBatches} (${batchFrames.length} frames)...`);
    
    sendFrameBatch(
      batchFrames, 
      {...baseRequestData, batch: currentBatch, totalBatches: numBatches},
      tabId,
      currentBatch,
      numBatches,
      (result) => {
        if (result && !result.error) {
          processedResults.push(result);
        }
        currentBatch++;
        processNextBatch();
      }
    );
  };
  
  // Start processing batches
  processNextBatch();
  
  // Function to send a single batch of frames
  function sendFrameBatch(batchFrames, requestData, tabId, batchNum, totalBatches, callback) {
    // Clone the request data and add the frames
    const fullRequestData = {
      ...requestData,
      frames: batchFrames
    };
    
    console.log(`Sending ${totalBatches > 1 ? `batch ${batchNum}/${totalBatches} with ` : ''}${batchFrames.length} frames to API`);
    
    // Add timeout for the API request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    // Send to API with explicit no-cache headers
    fetch(API_URL + '/frames', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': totalBatches > 1 ? `${requestData.id}-batch-${batchNum}` : requestData.id,
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      },
      body: JSON.stringify(fullRequestData),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorMsg = `API error: ${response.status}`;
        console.error(errorMsg);
        
        // Check for specific status codes
        if (response.status === 413) {
          throw new Error("Request too large. Try analyzing a shorter video segment.");
        } else if (response.status === 429) {
          throw new Error("Too many requests. Please try again later.");
        } else if (response.status >= 500) {
          throw new Error("Server error. Our detection service is currently experiencing issues.");
        } else {
          throw new Error(errorMsg);
        }
      }
      return response.json();
    })
    .then(result => {
      console.log(`API response ${totalBatches > 1 ? `for batch ${batchNum}/${totalBatches}` : ''}:`, result);
      
    

      // If this is the only batch or the last one, show the result directly
  if (totalBatches === 1) {
    // Calculate total processing time
    const totalTime = Math.round(performance.now() - startTime);
    
    // Validate and normalize the result
    const validatedResult = {
      deepfake: result.deepfake === true,
      confidence: parseFloat(result.confidence) || 0.5,
      frames_analyzed: parseInt(result.frames_analyzed) || batchFrames.length,
      deepfake_frames: parseInt(result.deepfake_frames) || 0,
      timestamp: requestData.timestamp,
      requestId: requestData.id,
      framesSent: batchFrames.length,
      frameTimes: metadata?.capturePositions || [],
      // Add timing information
      processingTime: totalTime,
      clientProcessingTime: totalTime,
      apiResponseTime: result.processing_time_ms || result.processing_time || 0
    };
        
        // Additional verification to ensure we got a valid result
        if (validatedResult.frames_analyzed === 0) {
          throw new Error("The API didn't analyze any frames. Please try again.");
        }
        
        // Show result
        showAnalysisResult(tabId, validatedResult, metadata);
      } else {
        // For multi-batch processing, call the callback with the result
        if (callback) callback(result);
      }
    })
    .catch(error => {
      clearTimeout(timeoutId);
      console.error(`API request failed ${totalBatches > 1 ? `for batch ${batchNum}/${totalBatches}` : ''}:`, error);
      
      // Create user-friendly error message
      let errorMessage = "Analysis failed";
      
      if (error.name === 'AbortError') {
        errorMessage = "Analysis timed out. The video may be too long or complex.";
      } else if (error.message) {
        errorMessage = `${errorMessage}: ${error.message}`;
      }
      
      // Only show error to user if this is the only batch or if we haven't started processing batches yet
      if (totalBatches === 1 || batchNum === 1) {
        notifyUser(tabId, "error", errorMessage);
      }
      
      // Call callback with error result
      if (callback) callback({ error: errorMessage });
    });
  }
  
  // Function to combine results from multiple batches
  function combineResults(results, tabId, metadata) {
    console.log(`Combining results from ${results.length} batches`);
    
    // Handle case where we have no valid results
    if (results.length === 0) {
      notifyUser(tabId, "error", "Analysis failed: No valid results received from any batch");
      return;
    }
    
    // Calculate combined metrics
    let totalFramesAnalyzed = 0;
    let totalDeepfakeFrames = 0;
    let totalConfidenceSum = 0;
    let hasDeepfake = false;
    
    // Process each batch result
    results.forEach(result => {
      const framesAnalyzed = parseInt(result.frames_analyzed) || 0;
      const deepfakeFrames = parseInt(result.deepfake_frames) || 0;
      const confidence = parseFloat(result.confidence) || 0.5;
      
      totalFramesAnalyzed += framesAnalyzed;
      totalDeepfakeFrames += deepfakeFrames;
      totalConfidenceSum += confidence * framesAnalyzed; // Weight by frames analyzed
      
      // If any batch detected deepfake with high confidence, mark as deepfake
      if (result.deepfake === true && confidence > 0.6) {
        hasDeepfake = true;
      }
    });
    
    // Determine final deepfake status based on proportion and confidence
    const deepfakeRatio = totalFramesAnalyzed > 0 ? totalDeepfakeFrames / totalFramesAnalyzed : 0;
    const averageConfidence = totalFramesAnalyzed > 0 ? totalConfidenceSum / totalFramesAnalyzed : 0.5;
    
    // Final decision logic - tuned to reduce false positives
    let finalDeepfakeStatus;
    if (hasDeepfake) {
      // If any batch had high confidence deepfake, trust that result
      finalDeepfakeStatus = true;
    } else if (deepfakeRatio >= 0.25) {
      // If a significant portion of frames were detected as deepfake
      finalDeepfakeStatus = true;
    } else {
      // Otherwise mark as authentic
      finalDeepfakeStatus = false;
    }
    
    console.log(`Combined analysis: ${deepfakeRatio.toFixed(4)} deepfake ratio (${totalDeepfakeFrames}/${totalFramesAnalyzed}), ${averageConfidence.toFixed(4)} avg confidence`);
    
    // Prepare the combined result
    const combinedResult = {
      deepfake: finalDeepfakeStatus,
      confidence: averageConfidence,
      frames_analyzed: totalFramesAnalyzed,
      deepfake_frames: totalDeepfakeFrames,
      timestamp: metadata.timestamp,
      requestId: metadata.randomId,
      framesSent: metadata.frameCount || frames.length, // Fixed: Use metadata.frameCount or fallback to frames.length
      frameTimes: metadata.capturePositions || [],
      batches: results.length
    };
    
    // Show the combined result
    showAnalysisResult(tabId, combinedResult, metadata);
  }
}



  // Show analysis result
function showAnalysisResult(tabId, result, metadata) {
    console.log("Showing analysis result:", result);


    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: result
    });
    
    
    // Save to history
    const historyEntry = {
      id: result.requestId,
      date: new Date().toISOString(),
      url: metadata.url,
      platform: metadata.platform || detectPlatformFromUrl(metadata.url),
      result: result
    };
    
    // Add to history
    analysisHistory.unshift(historyEntry);
    if (analysisHistory.length > 50) {
      analysisHistory = analysisHistory.slice(0, 50);
    }
    
    // Save to storage
    chrome.storage.local.set({analysisHistory: analysisHistory});
  }

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getHistory") {
    sendResponse({history: analysisHistory});
    return true;
  }
  else if (request.action === "analyzeUrl") {
    if (request.videoUrl) {
      sendResponse({success: true, message: "Analysis started"});
      
      // Create a tab to load the URL then analyze it
      chrome.tabs.create({ url: request.videoUrl, active: true }, (tab) => {
        // Wait for tab to load
        chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
          if (updatedTabId === tab.id && info.status === 'complete') {
            // Tab has loaded, analyze the video
            chrome.tabs.onUpdated.removeListener(listener);
            
            // Wait a bit for video to load
            setTimeout(() => {
              analyzeCurrentVideo(tab.id);
            }, 3000);
          }
        });
      });
    } else {
      sendResponse({success: false, error: "No URL provided"});
    }
    return true;
  }
  else if (request.action === "analyzeCurrentVideo") {
    // Handle based on whether we have tab info or need to query it
    if (sender.tab && sender.tab.id) {
      // Direct message from content script - we already have the tab ID
      const tabId = sender.tab.id;
      sendResponse({success: true, message: "Analysis started"});
      analyzeCurrentVideo(tabId);
    } else {
      // Need to query for current tab - tell sender we'll respond asynchronously
      sendResponse({success: true, message: "Finding active tab..."});
      
      // Get active tab
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs && tabs.length > 0) {
          analyzeCurrentVideo(tabs[0].id);
        } else {
          console.error("No active tab found for video analysis");
        }
      });
    }
    return true;  // Keep message channel open
  }
  else if (request.action === "clearHistory") {
    analysisHistory = [];
    chrome.storage.local.set({analysisHistory: []});
    sendResponse({success: true, message: "History cleared"});
    return true;
  }
});

// Helper function to detect platform from URL
function detectPlatformFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    } else if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
      return 'facebook';
    } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return 'twitter';
    } else if (hostname.includes('instagram.com') || hostname.includes('ig.com')) {
      return 'instagram';
    } else if (hostname.includes('tiktok.com')) {
      return 'tiktok';
    } else if (hostname.includes('threads.net')) {
      return 'threads';
    } else {
      return 'generic';
    }
  } catch (_) {
    return 'generic';
  }
}

console.log("DeepFake Detector background script loaded");