// T699: a reference across namespaces, none of them versioned, is
// written with its namespace (DXNS.md §6): a field, a template instance,
// a base (extends) and a spread (includes).
namespace Shop {
  model User {
    name: string;
  }

  model Page<T> {
    items: T[];
  }
}

namespace Event {
  model Message {
    sender: Shop.User;
    recipients: Shop.Page<Shop.User>;
    note?: Note;
  }

  model Note {
    text: string;
  }

  model Admin extends Shop.User {
    level: int32;
  }

  model Copy {
    ...Shop.User;
    extra: string;
  }
}
