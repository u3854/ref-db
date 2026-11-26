"""Tests for 3D Euler decomposition and spatial head-torso pairing."""

import math
import numpy as np

from backend.ml.pose import pair_heads_and_torsos, rotation_matrix_to_euler


def test_rotation_matrix_identity():
    pitch, yaw, roll = rotation_matrix_to_euler(np.eye(3))
    assert abs(pitch) < 1e-6
    assert abs(yaw) < 1e-6
    assert abs(roll) < 1e-6


def test_rotation_matrix_yaw_and_pitch():
    angle = math.radians(35.0)
    # Rotation around Y-axis (yaw)
    ry = np.array(
        [
            [math.cos(angle), 0.0, math.sin(angle)],
            [0.0, 1.0, 0.0],
            [-math.sin(angle), 0.0, math.cos(angle)],
        ]
    )
    pitch, yaw, roll = rotation_matrix_to_euler(ry)
    assert math.isclose(yaw, 35.0, abs_tol=1e-4)
    assert abs(pitch) < 1e-4
    assert abs(roll) < 1e-4


def test_pair_heads_and_torsos_two_people():
    # Person A on left (x ~ 0.25), Person B on right (x ~ 0.75)
    heads = [
        {"yaw": -40.0, "pitch": 0.0, "roll": 0.0, "cx": 0.75, "cy": 0.25, "size": 0.12},
        {"yaw": 30.0, "pitch": 5.0, "roll": 0.0, "cx": 0.25, "cy": 0.28, "size": 0.12},
    ]
    torsos = [
        {"yaw": 10.0, "lean": 0.0, "cx": 0.25, "cy": 0.42, "span": 0.22},
        {"yaw": -50.0, "lean": 5.0, "cx": 0.75, "cy": 0.40, "span": 0.22},
    ]
    subjects = pair_heads_and_torsos(heads, torsos)
    assert len(subjects) == 2

    paired_map = {s["head"]["yaw"]: s["torso"]["yaw"] for s in subjects}
    assert paired_map[-40.0] == -50.0
    assert paired_map[30.0] == 10.0
