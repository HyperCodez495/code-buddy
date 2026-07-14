import unittest

from watch import (
    MOTION_FRAME_SLOTS,
    SEMANTIC_FRAME_SLOTS,
    CameraLivenessState,
    MotionEventState,
    PersonState,
    normalized_box,
)


class NormalizedBoxTests(unittest.TestCase):
    def test_normalizes_and_clamps_pixels_without_depth(self):
        self.assertEqual(
            normalized_box(-10, 20, 120, 80, 100, 100),
            {"x": 0.0, "y": 0.2, "width": 1.0, "height": 0.6},
        )
        self.assertIsNone(normalized_box(10, 10, 10, 20, 100, 100))
        self.assertIsNone(normalized_box(0, 0, 10, 10, 0, 100))


class PersonStateTests(unittest.TestCase):
    def test_tracker_is_opaque_stable_for_one_presence_episode_and_then_rotates(self):
        state = PersonState(episode_prefix="testscope")
        state.grace = 2

        entered = state.update(True)
        self.assertEqual(entered, ("person_entered", 200, "anon-testscope-1"))
        self.assertEqual(state.presence_episode_id, "anon-testscope-1")
        self.assertIsNone(state.update(True))
        self.assertIsNone(state.update(False))
        self.assertEqual(
            state.update(False),
            ("person_lost", 120, "anon-testscope-1"),
        )
        self.assertIsNone(state.presence_episode_id)
        self.assertEqual(
            state.update(True),
            ("person_entered", 200, "anon-testscope-2"),
        )


class CameraLivenessTests(unittest.TestCase):
    def test_emits_refresh_failure_transition_and_recovery(self):
        state = CameraLivenessState(heartbeat_secs=5, failure_grace=2)

        self.assertEqual(state.update(True, at=0), ("camera_alive", 10))
        self.assertIsNone(state.update(True, at=4))
        self.assertEqual(state.update(True, at=5), ("camera_alive", 10))
        self.assertIsNone(state.update(False, at=6))
        self.assertEqual(state.update(False, at=7), ("camera_unavailable", 180))
        self.assertIsNone(state.update(False, at=8))
        self.assertEqual(state.update(False, at=12), ("camera_unavailable", 180))
        self.assertEqual(state.update(True, at=13), ("camera_alive", 10))

        clamped = CameraLivenessState(heartbeat_secs=60, failure_grace=2)
        self.assertEqual(clamped.heartbeat_secs, 10)


class MotionEventTests(unittest.TestCase):
    def test_emits_first_motion_then_respects_bounded_refresh_cadence(self):
        state = MotionEventState(cooldown_secs=8)

        self.assertFalse(state.should_emit(False, at=0))
        self.assertTrue(state.should_emit(True, at=1))
        self.assertFalse(state.should_emit(True, at=8.9))
        self.assertTrue(state.should_emit(True, at=9))
        self.assertFalse(state.should_emit(False, at=20))
        self.assertGreaterEqual(MOTION_FRAME_SLOTS, 16)
        self.assertLessEqual(MOTION_FRAME_SLOTS, 128)
        self.assertGreaterEqual(SEMANTIC_FRAME_SLOTS, 64)
        self.assertLessEqual(SEMANTIC_FRAME_SLOTS, 256)


if __name__ == "__main__":
    unittest.main()
