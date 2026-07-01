import os


def is_path_inside(root_path, candidate_path):
    root_path = os.path.realpath(root_path)
    candidate_path = os.path.realpath(candidate_path)
    try:
        return os.path.commonpath([root_path, candidate_path]) == root_path
    except ValueError:
        return False

