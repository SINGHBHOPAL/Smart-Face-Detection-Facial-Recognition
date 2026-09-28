import os
import cv2
import numpy as np
import urllib.request
from config import config

class FaceDetector:
    def __init__(self):
        self.cascade_path = config.HAAR_CASCADE_FACE
        self.ensure_cascade_exists()
        self.face_cascade = cv2.CascadeClassifier(self.cascade_path)
        
        # Initialize LBPH Face Recognizer
        self.recognizer = cv2.face.LBPHFaceRecognizer_create()
        self.model_path = os.path.join(config.MODEL_DIR, 'lbph_model.yml')
        self.is_trained = False
        self.load_model()

    def ensure_cascade_exists(self):
        """Downloads the Haar Cascade XML if it doesn't exist."""
        if not os.path.exists(self.cascade_path):
            print(f"Haar Cascade not found at {self.cascade_path}. Downloading...")
            url = "https://raw.githubusercontent.com/opencv/opencv/4.x/data/haarcascades/haarcascade_frontalface_default.xml"
            try:
                urllib.request.urlretrieve(url, self.cascade_path)
                print("Download completed successfully.")
            except Exception as e:
                print(f"Error downloading cascade: {e}")
                # Create a minimal directory structure or handle error
                raise FileNotFoundError(f"Could not download Haar Cascade XML. Please download manually to {self.cascade_path}")

    def load_model(self):
        """Loads the trained LBPH model if it exists."""
        if os.path.exists(self.model_path):
            try:
                self.recognizer.read(self.model_path)
                self.is_trained = True
                print("Trained LBPH model loaded successfully.")
            except Exception as e:
                print(f"Error loading trained model: {e}")
                self.is_trained = False
        else:
            print("No trained model found. Face recognition will classify all faces as 'Unknown'.")
            self.is_trained = False

    def train_model(self, db_records):
        """Trains the LBPH model on registered faces."""
        faces = []
        ids = []
        
        for record in db_records:
            # record contains (id, name, image_path)
            face_id = record[0]
            img_path = record[2]
            
            if os.path.exists(img_path):
                # Read image in grayscale
                img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    # Resize to a consistent size for LBP training
                    img_resized = cv2.resize(img, (150, 150))
                    faces.append(img_resized)
                    ids.append(face_id)
                else:
                    print(f"Warning: Could not read image {img_path}")
            else:
                print(f"Warning: Face image path not found: {img_path}")
                
        if len(faces) > 0:
            try:
                self.recognizer.train(faces, np.array(ids))
                self.recognizer.save(self.model_path)
                self.is_trained = True
                print(f"Model successfully trained on {len(faces)} faces.")
                return True
            except Exception as e:
                print(f"Error training model: {e}")
                return False
        else:
            print("No faces to train on.")
            self.is_trained = False
            # Remove existing model if training is empty
            if os.path.exists(self.model_path):
                os.remove(self.model_path)
            return False

    def crop_face(self, frame):
        """Detects a face in the frame, crops it, and returns the cropped grayscale image."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        
        if len(faces) > 0:
            # Sort by size to get the largest face (assumed to be primary user)
            faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            x, y, w, h = faces[0]
            # Crop the face with padding
            pad_h = int(h * 0.1)
            pad_w = int(w * 0.1)
            y1 = max(0, y - pad_h)
            y2 = min(frame.shape[0], y + h + pad_h)
            x1 = max(0, x - pad_w)
            x2 = min(frame.shape[1], x + w + pad_w)
            
            cropped = gray[y1:y2, x1:x2]
            return cv2.resize(cropped, (150, 150)), (x, y, w, h)
        return None, None

    def detect_and_recognize(self, frame, id_to_name_map):
        """
        Detects all faces in the frame and attempts to recognize them.
        Returns a list of dictionaries with bounding boxes and names.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))
        
        results = []
        for (x, y, w, h) in faces:
            name = "Unknown"
            confidence = 100.0  # LBPH distance (lower is better, 0 is perfect)
            
            if self.is_trained:
                try:
                    # Crop and resize to 150x150
                    face_roi = gray[y:y+h, x:x+w]
                    face_roi_resized = cv2.resize(face_roi, (150, 150))
                    
                    label_id, dist = self.recognizer.predict(face_roi_resized)
                    # Lower distance = higher confidence
                    # Typically distance below 75 is a good match
                    if dist < 85:
                        name = id_to_name_map.get(label_id, "Unknown")
                        # Normalize distance to a confidence percentage (heuristic)
                        confidence = round(max(0, 100 - dist), 1)
                    else:
                        name = "Unknown"
                        confidence = round(max(0, 100 - dist), 1)
                except Exception as e:
                    print(f"Error during face prediction: {e}")
            
            results.append({
                'box': [int(x), int(y), int(w), int(h)],
                'name': name,
                'confidence': confidence
            })
            
        return results
