"""Use an in-process editor fixture for isolated backend test subprocesses."""
import review_host_client
from review_host_test_support import FakeHostSession
review_host_client.HostSession = FakeHostSession
