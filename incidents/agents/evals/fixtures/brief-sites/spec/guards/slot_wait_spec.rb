RSpec.describe "slot_wait callers" do
  ALLOWED = %w[lib/app/api_clients/coingecko/api.rb].freeze

  it "is only called inside the client" do
    callers = `grep -rln "slot_wait" lib bin`.split.reject { |path| ALLOWED.include?(path) }
    expect(callers).to be_empty
  end
end
