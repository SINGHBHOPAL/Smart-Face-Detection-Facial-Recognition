import os
import time
from datetime import datetime, timedelta
import numpy as np
import cv2
from flask import Flask, request, jsonify, render_template, send_from_directory
from config import config
from Backend_Server.Database.models import db, FaceRegistration, DetectionLog
from AI_Vision.detector import FaceDetector

# Configure Flask app paths pointing to Frontend_Server
TEMPLATE_DIR = os.path.abspath(os.path.join(config.BASE_DIR, 'Frontend_Server'))
STATIC_DIR = os.path.abspath(os.path.join(config.BASE_DIR, 'Frontend_Server', 'static'))

app = Flask(
    __name__,
    template_folder=TEMPLATE_DIR,
    static_folder=STATIC_DIR,
    static_url_path='/static'
)

# Apply configurations
app.config['SQLALCHEMY_DATABASE_URI'] = config.SQLALCHEMY_DATABASE_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = config.SQLALCHEMY_TRACK_MODIFICATIONS
app.config['SECRET_KEY'] = config.SECRET_KEY

# Initialize database
db.init_app(app)

# Initialize detector
detector = FaceDetector()

# In-memory debounce cache to avoid flooding the database during live webcam stream
# Format: {name: last_detected_timestamp}
last_logged_time = {}
DEBOUNCE_INTERVAL = 10.0  # seconds

# Helper to check if file type is allowed
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in config.ALLOWED_EXTENSIONS

# Serve face images from AI_Vision/faces
@app.route('/AI_Vision/faces/<filename>')
def serve_registered_face(filename):
    return send_from_directory(config.FACES_DIR, filename)

# Serve detection log images
@app.route('/Backend_Server/Database/detections/<filename>')
def serve_detection_log_image(filename):
    return send_from_directory(config.DETECTIONS_DIR, filename)

# Main route
@app.route('/')
def index():
    return render_template('index.html')

# Endpoint: Process image/frame for detection and recognition
@app.route('/api/detect', methods=['POST'])
def detect_faces():
    if 'image' not in request.files:
        return jsonify({'success': False, 'message': 'No image file uploaded'}), 400
        
    file = request.files['image']
    if file.filename == '':
        return jsonify({'success': False, 'message': 'Empty file uploaded'}), 400
        
    try:
        # Read image bytes directly
        img_bytes = file.read()
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({'success': False, 'message': 'Failed to decode image'}), 400
            
        # Get registration mapping from DB for recognition
        registrations = FaceRegistration.query.all()
        id_to_name_map = {r.id: r.name for r in registrations}
        
        # Run detection & recognition
        results = detector.detect_and_recognize(frame, id_to_name_map)
        
        # Handle log saving logic
        if len(results) > 0:
            current_time = time.time()
            should_log = False
            detected_names = []
            
            for face in results:
                name = face['name']
                detected_names.append(name)
                
                # Debounce log logic for live webcam stream
                if name != "Unknown":
                    # Log if name not logged recently
                    if name not in last_logged_time or (current_time - last_logged_time[name] > DEBOUNCE_INTERVAL):
                        should_log = True
                        last_logged_time[name] = current_time
                else:
                    # Log unknown face if not logged in last interval
                    if "Unknown" not in last_logged_time or (current_time - last_logged_time["Unknown"] > DEBOUNCE_INTERVAL):
                        should_log = True
                        last_logged_time["Unknown"] = current_time

            # Force logging for static scanner uploads (which will have a query param log=true, or check filename)
            is_scanner_upload = file.filename != 'frame.jpg'
            if is_scanner_upload:
                should_log = True

            if should_log:
                # Save the visual frame with bounding boxes to detections folder
                marked_frame = frame.copy()
                for face in results:
                    x, y, w, h = face['box']
                    color = (0, 0, 255) if face['name'] == 'Unknown' else (0, 255, 0)
                    cv2.rectangle(marked_frame, (x, y), (x+w, y+h), color, 2)
                    cv2.putText(marked_frame, f"{face['name']} ({face['confidence']}%)", 
                                (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
                timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                marked_filename = f"det_{timestamp_str}.jpg"
                marked_filepath = os.path.join(config.DETECTIONS_DIR, marked_filename)
                cv2.imwrite(marked_filepath, marked_frame)
                
                # Save record to DB
                db_image_path = f"Backend_Server/Database/detections/{marked_filename}"
                names_str = ",".join(detected_names)
                
                log_entry = DetectionLog(
                    face_count=len(results),
                    detected_names=names_str,
                    image_path=db_image_path
                )
                db.session.add(log_entry)
                db.session.commit()
                
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        print(f"Error processing detection request: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

# Endpoint: Register a new face and retrain model
@app.route('/api/register', methods=['POST'])
def register_face():
    if 'name' not in request.form or 'image' not in request.files:
        return jsonify({'success': False, 'message': 'Missing name or image'}), 400
        
    name = request.form['name'].strip()
    file = request.files['image']
    
    if not name or file.filename == '':
        return jsonify({'success': False, 'message': 'Invalid name or file'}), 400
        
    try:
        # Read uploaded image bytes
        img_bytes = file.read()
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({'success': False, 'message': 'Failed to decode image'}), 400
            
        # Detect and crop the face first (to save clean profile thumbnail)
        cropped_face, _ = detector.crop_face(frame)
        if cropped_face is None:
            return jsonify({
                'success': False, 
                'message': 'No face detected in the registration portrait. Please upload a clear photo.'
            }), 400
            
        # Create a database record to retrieve a unique ID
        new_face = FaceRegistration(name=name, image_path="temp")
        db.session.add(new_face)
        db.session.commit()
        
        # Save cropped face to disk with filename based on ID
        filename = f"face_{new_face.id}.jpg"
        filepath = os.path.join(config.FACES_DIR, filename)
        cv2.imwrite(filepath, cropped_face)
        
        # Update database with correct image path
        db_image_path = f"AI_Vision/faces/{filename}"
        new_face.image_path = db_image_path
        db.session.commit()
        
        # Query all registrations and retrain LBPH model
        registrations = FaceRegistration.query.all()
        training_records = [(r.id, r.name, os.path.join(config.BASE_DIR, r.image_path)) for r in registrations]
        
        retrained = detector.train_model(training_records)
        
        return jsonify({
            'success': True,
            'message': f"Registered {name} successfully.",
            'retrained': retrained
        })
        
    except Exception as e:
        print(f"Error during registration: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

# Endpoint: List all registered faces and handle deletions
@app.route('/api/faces', methods=['GET', 'DELETE'])
def manage_faces():
    if request.method == 'GET':
        try:
            faces = FaceRegistration.query.all()
            return jsonify({
                'success': True,
                'faces': [f.to_dict() for f in faces]
            })
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500
            
    elif request.method == 'DELETE':
        face_id = request.args.get('id')
        if not face_id:
            return jsonify({'success': False, 'message': 'Missing face id'}), 400
            
        try:
            face = FaceRegistration.query.get(face_id)
            if not face:
                return jsonify({'success': False, 'message': 'Identity not found'}), 404
                
            # Remove file from disk
            full_filepath = os.path.join(config.BASE_DIR, face.image_path)
            if os.path.exists(full_filepath):
                os.remove(full_filepath)
                
            # Delete from DB
            db.session.delete(face)
            db.session.commit()
            
            # Retrain model with remaining faces
            registrations = FaceRegistration.query.all()
            training_records = [(r.id, r.name, os.path.join(config.BASE_DIR, r.image_path)) for r in registrations]
            detector.train_model(training_records)
            
            return jsonify({'success': True, 'message': 'Identity deleted successfully'})
            
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500

# Endpoint: Get detection logs history
@app.route('/api/logs', methods=['GET', 'DELETE'])
def manage_logs():
    if request.method == 'GET':
        try:
            logs = DetectionLog.query.order_by(DetectionLog.timestamp.desc()).limit(50).all()
            return jsonify({
                'success': True,
                'logs': [l.to_dict() for l in logs]
            })
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500
            
    elif request.method == 'DELETE':
        try:
            # Delete all log entries in DB
            db.session.query(DetectionLog).delete()
            db.session.commit()
            
            # Delete physical detection images on disk
            for filename in os.listdir(config.DETECTIONS_DIR):
                filepath = os.path.join(config.DETECTIONS_DIR, filename)
                if os.path.isfile(filepath):
                    os.remove(filepath)
                    
            return jsonify({'success': True, 'message': 'All detection logs cleared.'})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500

# Endpoint: Analytics statistics and charts
@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        registered_count = FaceRegistration.query.count()
        total_scans = DetectionLog.query.count()
        
        # Calculate match rate (percentage of scans where at least one face is recognized, i.e., not just 'Unknown' in names)
        # Fetch last 100 logs to calculate rate
        recent_logs = DetectionLog.query.order_by(DetectionLog.timestamp.desc()).limit(100).all()
        matches = 0
        for log in recent_logs:
            if log.detected_names:
                names = log.detected_names.split(',')
                # If there's any name that is not 'Unknown', consider it a match
                if any(name != 'Unknown' for name in names):
                    matches += 1
                    
        match_rate = round((matches / len(recent_logs)) * 100, 1) if len(recent_logs) > 0 else 0.0
        
        # Calculate daily scans for the last 7 days of the week (Mon to Sun)
        daily_activity = {day: 0 for day in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
        
        # Query logs from last 7 days
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        logs_past_week = DetectionLog.query.filter(DetectionLog.timestamp >= seven_days_ago).all()
        
        for log in logs_past_week:
            # Day name (Mon, Tue...)
            day_name = log.timestamp.strftime('%a')
            if day_name in daily_activity:
                daily_activity[day_name] += 1
                
        return jsonify({
            'success': True,
            'stats': {
                'registered_faces': registered_count,
                'total_scans': total_scans,
                'match_rate': match_rate,
                'daily_activity': daily_activity
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# Function to initialize database and train detector on startup
def init_application():
    with app.app_context():
        # Ensure database tables exist
        db.create_all()
        
        # Retrain face recognition model if registrations exist
        registrations = FaceRegistration.query.all()
        if len(registrations) > 0:
            print("Retraining face recognizer model on application startup...")
            training_records = [(r.id, r.name, os.path.join(config.BASE_DIR, r.image_path)) for r in registrations]
            detector.train_model(training_records)
        else:
            print("No registrations found. Detector running in detection-only mode.")
            
if __name__ != '__main__':
    # Initialize when imported (e.g. by production server)
    init_application()
