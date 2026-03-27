using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.Data;
using System.Dynamic;
using System.Text.Json;
using System.Xml.Linq;

// Array
int[] array = [1, 2, 3, 4, 5, 10, 42, 99];

// List
List<string> list = ["Alice", "Bob", "Charlie", "Diana", "Eve"];

// HashSet
HashSet<int> hashSet = [1, 2, 3, 4, 5, 3, 2]; // duplicates ignored

// Dictionary
Dictionary<string, int> dictionary = new()
{
    ["one"] = 1,
    ["two"] = 2,
    ["three"] = 3,
    ["four"] = 4,
    ["five"] = 5
};

// DataTable
DataTable dataTable = new("Employees");
dataTable.Columns.Add("Id", typeof(int));
dataTable.Columns.Add("Name", typeof(string));
dataTable.Columns.Add("Department", typeof(string));
dataTable.Columns.Add("Salary", typeof(decimal));
dataTable.Rows.Add(1, "Alice", "Engineering", 85000m);
dataTable.Rows.Add(2, "Bob", "Marketing", 72000m);
dataTable.Rows.Add(3, "Charlie", "Engineering", 91000m);
dataTable.Rows.Add(4, "Diana", "HR", 68000m);

// DataSet
DataSet dataSet = new("Company");
DataTable products = new("Products");
products.Columns.Add("ProductId", typeof(int));
products.Columns.Add("ProductName", typeof(string));
products.Columns.Add("Price", typeof(decimal));
products.Rows.Add(101, "Laptop", 999.99m);
products.Rows.Add(102, "Mouse", 29.99m);
products.Rows.Add(103, "Keyboard", 79.99m);
dataSet.Tables.Add(dataTable.Copy());
dataSet.Tables.Add(products);

// Dictionary<string, DataTable>
Dictionary<string, DataTable> dictOfTables = new()
{
    ["Employees"] = dataTable,
    ["Products"] = products
};

// JSON string
string jsonString = JsonSerializer.Serialize(new
{
    name = "Alice",
    age = 30,
    hobbies = new[] { "reading", "coding", "hiking" },
    address = new { city = "Rome", country = "Italy" }
}, new JsonSerializerOptions { WriteIndented = true });

// ── Record instances
Person person = new("Alice", 30, "Rome");

// ── List<Record>
List<Person> people =
[
    new("Alice",   30, "Rome"),
    new("Bob",     25, "Milan"),
    new("Charlie", 35, "Naples"),
    new("Diana",   28, "Turin"),
];

// ── List<class>
List<Product> products2 =
[
    new() { Id = 1, Name = "Laptop",   Price = 999.99m, InStock = true  },
    new() { Id = 2, Name = "Mouse",    Price =  29.99m, InStock = true  },
    new() { Id = 3, Name = "Monitor",  Price = 349.99m, InStock = false },
    new() { Id = 4, Name = "Keyboard", Price =  79.99m, InStock = true  },
];

// ── Tuple / ValueTuple
(string FirstName, string LastName, int Age) valueTuple = ("John", "Doe", 42);
Tuple<string, int, bool> tuple = Tuple.Create("item-one", 100, true);
Tuple<int, string, decimal, bool> tupleMulti = Tuple.Create(42, "product", 99.99m, true);
var nestedTuple = (Id: 1, Details: (Name: "Alice", Active: true), Tags: new[] { "vip", "verified" });

// ── ConcurrentBag<T>
ConcurrentBag<string> concurrentBag = new(["item1", "item2", "item3"]);
concurrentBag.Add("item4");

// ── ConcurrentDictionary<K, V>
ConcurrentDictionary<string, int> concurrentDict = new()
{
    ["Alice"] = 30,
    ["Bob"] = 25,
    ["Charlie"] = 35
};
concurrentDict.TryAdd("Diana", 28);

// ── ConcurrentQueue<T>
ConcurrentQueue<int> concurrentQueue = new([10, 20, 30]);
concurrentQueue.Enqueue(40);

// ── ConcurrentStack<T>
ConcurrentStack<string> concurrentStack = new(["bottom", "middle", "top"]);
concurrentStack.Push("new-top");

// ── PriorityQueue<T, TPriority>
PriorityQueue<string, int> priorityQueue = new();
priorityQueue.Enqueue("High priority task", 1);
priorityQueue.Enqueue("Low priority task", 10);
priorityQueue.Enqueue("Medium priority task", 5);

// ── Queue<T>
Queue<string> queue = new();
queue.Enqueue("first");
queue.Enqueue("second");
queue.Enqueue("third");

// ── Stack<T>
Stack<int> stack = new();
stack.Push(10);
stack.Push(20);
stack.Push(30);

// ── SortedDictionary
SortedDictionary<string, double> sortedDict = new()
{
    ["banana"] = 0.99,
    ["apple"] = 1.49,
    ["cherry"] = 3.20,
    ["date"] = 5.00,
};

// ── LinkedList<T>
LinkedList<string> linkedList = new(["head", "middle-1", "middle-2", "tail"]);

// ── ObservableCollection<T>
ObservableCollection<Person> observableCollection = new(people);

// ── ExpandoObject
dynamic expando = new ExpandoObject();
expando.Name = "Dynamic Object";
expando.Version = 3;
expando.Tags = new[] { "dynamic", "expando", "test" };

// ── ILookup (grouping people by city first char)
ILookup<char, Person> lookup = people.ToLookup(p => p.City[0]);

// ── Jagged array
int[][] jaggedArray =
[
    [1, 2, 3],
    [4, 5],
    [6, 7, 8, 9],
];

// ── 2D array
int[,] matrix = { { 1, 2, 3 }, { 4, 5, 6 }, { 7, 8, 9 } };

// ── NameValueCollection
NameValueCollection nameValueCollection = new()
{
    { "Accept",       "application/json" },
    { "Content-Type", "application/json" },
    { "Authorization","Bearer token123"  },
};

// ── XML string
string xmlString = new XDocument(
    new XElement("catalog",
        new XElement("book", new XAttribute("id", "b1"),
            new XElement("title", "Clean Code"),
            new XElement("author", "Robert C. Martin"),
            new XElement("price", "34.99")),
        new XElement("book", new XAttribute("id", "b2"),
            new XElement("title", "The Pragmatic Programmer"),
            new XElement("author", "Andrew Hunt"),
            new XElement("price", "49.95"))
    )).ToString();

// ── HTML string
string htmlString = """
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>Test Page</title></head>
    <body>
      <h1>Hello Visualizer</h1>
      <table border="1">
        <tr><th>Name</th><th>Age</th></tr>
        <tr><td>Alice</td><td>30</td></tr>
        <tr><td>Bob</td><td>25</td></tr>
      </table>
    </body>
    </html>
    """;

// ── Markdown string
string markdownString = """
    # Main Title
    
    ## Section 1
    
    This is a paragraph with **bold** and *italic* text.
    
    ### Subsection 1.1
    
    - Item one
    - Item two
    - Item three
    
    ### Subsection 1.2
    
    1. First point
    2. Second point
    3. Third point
    
    ## Code Example
    
    ```csharp
    var result = people
        .Where(p => p.Age >= 30)
        .Select(p => p.Name)
        .ToList();
    ```
    
    | Header 1 | Header 2 |
    |----------|----------|
    | Row 1    | Data 1   |
    | Row 2    | Data 2   |
    """;

// ── JSON string (compact, no line breaks)
string compactJsonString = JsonSerializer.Serialize(new
{
    name = "Alice",
    age = 30,
    hobbies = new[] { "reading", "coding", "hiking" },
    address = new { city = "Rome", country = "Italy" }
});

// ── LINQ projection (anonymous type list)
var linqResult = people
    .Where(p => p.Age >= 28)
    .OrderBy(p => p.Name)
    .Select(p => new { p.Name, p.Age, Label = $"{p.Name} ({p.Age})" })
    .ToList();

// ── Test: Long List (200+ rows)
List<string> longList = new();
for (int i = 1; i <= 250; i++)
{
    longList.Add($"Item_{i:D4} - Long List Test Entry Number {i}");
}

// ── Test: Large Table (500+ rows and 100+ columns)
DataTable largeTable = new("LargeDataSet");

// Add 100+ columns
for (int col = 1; col <= 105; col++)
{
    largeTable.Columns.Add($"Column_{col:D3}", typeof(string));
}

// Add 500+ rows
for (int row = 1; row <= 550; row++)
{
    object[] values = new object[105];
    for (int col = 0; col < 105; col++)
    {
        if (col != 0 && row / col == 1)
            values[col] = null;
        else
            values[col] = $"R{row:D4}_C{col + 1:D3}_{Guid.NewGuid().ToString().Substring(0, 8)}";
    }
    largeTable.Rows.Add(values);
}

// breakpoint here to inspect all variables
Console.WriteLine("All variables initialized. Set a breakpoint on this line to inspect them.");
Console.WriteLine($"array        : [{string.Join(", ", array)}]");
Console.WriteLine($"list         : [{string.Join(", ", list)}]");
Console.WriteLine($"hashSet      : [{string.Join(", ", hashSet)}]");
Console.WriteLine($"dictionary   : {dictionary.Count} entries");
Console.WriteLine($"dataTable    : {dataTable.Rows.Count} rows, {dataTable.Columns.Count} cols");
Console.WriteLine($"dataSet      : {dataSet.Tables.Count} tables");
Console.WriteLine($"dictOfTables : {dictOfTables.Count} entries");
Console.WriteLine($"jsonString   :\n{jsonString}");
Console.WriteLine($"compactJsonString: {compactJsonString}");
Console.WriteLine($"markdownString (first 100 chars): {markdownString}...");
Console.WriteLine($"valueTuple   : Name={valueTuple.FirstName}, Age={valueTuple.Age}");
Console.WriteLine($"tuple        : Item1={tuple.Item1}, Item3={tuple.Item3}");
Console.WriteLine($"concurrentBag: {concurrentBag.Count} items");
Console.WriteLine($"concurrentDict: {concurrentDict.Count} entries");
Console.WriteLine($"concurrentQueue: {concurrentQueue.Count} items");
Console.WriteLine($"concurrentStack: {concurrentStack.Count} items");
Console.WriteLine($"priorityQueue: {priorityQueue.Count} items");
Console.WriteLine($"\n📊 Large Data Tests:");
Console.WriteLine($"longList     : {longList.Count} items");
Console.WriteLine($"largeTable   : {largeTable.Rows.Count} rows, {largeTable.Columns.Count} columns");

// ── Record
record Person(string Name, int Age, string City);

// ── Custom class
class Product
{
    public int Id { get; init; }
    public string Name { get; init; } = "";
    public decimal Price { get; init; }
    public bool InStock { get; init; }
}
