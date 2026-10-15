#include "common.h"

#include <cstdlib>
#include <iostream>
#include <map>
#include <memory>

// Replace JSI field access with value-only doubles; compile the exact production
// grammar classification branch from JSIParams.cpp into classify().
void lm_ggml_abort(const char *, int, const char *, ...) { std::abort(); }
namespace jsi {
struct Runtime {};
struct Object;
struct Value {
    std::shared_ptr<Object> object;
    std::string string;
    int number = 0;
    bool boolean = false;
    bool isObject() const { return bool(object); }
    Object asObject(Runtime &) const;
};
struct Object {
    std::map<std::string, Value> fields;
    bool hasProperty(Runtime &, const char * name) const { return fields.count(name) != 0; }
    Value getProperty(Runtime &, const char * name) const {
        auto item = fields.find(name);
        return item == fields.end() ? Value{} : item->second;
    }
};
Object Value::asObject(Runtime &) const { return *object; }
} // namespace jsi

std::string getPropertyAsString(jsi::Runtime & runtime, const jsi::Object & object, const char * name) {
    return object.getProperty(runtime, name).string;
}
int getPropertyAsInt(jsi::Runtime & runtime, const jsi::Object & object, const char * name, int fallback) {
    return object.hasProperty(runtime, name) ? object.getProperty(runtime, name).number : fallback;
}
bool getPropertyAsBool(jsi::Runtime & runtime, const jsi::Object & object, const char * name, bool fallback) {
    return object.hasProperty(runtime, name) ? object.getProperty(runtime, name).boolean : fallback;
}

common_grammar_type classify(const jsi::Object & params) {
    jsi::Runtime runtime;
    struct { common_grammar grammar; } sparams;
    // __GRAMMAR_CLASSIFICATION__
    return sparams.grammar.type;
}

int main() {
    int failures = 0;
    auto check = [&](const char * name, bool provenance, int chat_format,
                     const std::string & format, common_grammar_type expected) {
        jsi::Object params;
        jsi::Object response;
        params.fields["grammar"].string = "root ::= \"user-supplied\"";
        params.fields["chat_format"].number = chat_format;
        if (provenance) {
            params.fields["grammar_from_chat_template"].boolean = true;
        }
        if (!format.empty()) {
            response.fields["type"].string = format;
            params.fields["response_format"].object = std::make_shared<jsi::Object>(response);
        }
        common_grammar_type actual = classify(params);
        bool pass = actual == expected;
        std::cout << (pass ? "PASS " : "FAIL ") << name
                  << " (expected=" << expected << ", actual=" << actual << ")\n";
        failures += !pass;
    };
    check("user grammar with schema and chat format stays USER", false, 2, "json_schema", COMMON_GRAMMAR_TYPE_USER);
    check("formatter schema grammar becomes OUTPUT_FORMAT", true, 2, "json_schema", COMMON_GRAMMAR_TYPE_OUTPUT_FORMAT);
    check("formatter JSON object grammar becomes OUTPUT_FORMAT", true, 2, "json_object", COMMON_GRAMMAR_TYPE_OUTPUT_FORMAT);
    check("plain user grammar stays USER", false, 0, "", COMMON_GRAMMAR_TYPE_USER);
    check("marker without chat format stays USER", true, 0, "json_schema", COMMON_GRAMMAR_TYPE_USER);
    check("text format stays USER", true, 2, "text", COMMON_GRAMMAR_TYPE_USER);
    return failures == 0 ? 0 : 1;
}
