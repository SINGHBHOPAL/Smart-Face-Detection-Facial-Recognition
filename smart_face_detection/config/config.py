import os

# Base Directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Database Configuration
DB_PATH = os.path.join(BASE_DIR, 'Backend_Server', 'Database', 'database.db')
SQLALCHEMY_DATABASE_URI = f'sqlite:///{DB_PATH}'
SQLALCHEMY_TRACK_MODIFICATIONS = False

# AI Vision Configurations
FACES_DIR = os.path.join(BASE_DIR, 'AI_Vision', 'faces')
MODEL_DIR = os.path.join(BASE_DIR, 'AI_Vision', 'model')
HAAR_CASCADE_FACE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'haarcascade_frontalface_default.xml')

# Storage for detection logs
DETECTIONS_DIR = os.path.join(BASE_DIR, 'Backend_Server', 'Database', 'detections')

# Flask Configurations
SECRET_KEY = 'smart_face_detection_secret_key'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

# Ensure required directories exist
for directory in [FACES_DIR, MODEL_DIR, DETECTIONS_DIR]:
    os.makedirs(directory, exist_ok=True)
